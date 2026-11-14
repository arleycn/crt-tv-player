/**
 * CRT 管面渲染器（纯函数，不依赖 Preact）。归 src/player/，与 geometry.ts 同层。
 *
 * 首页录像、彩蛋影片、开机雪花都走同一个片元着色器 —— 显示区域只有一套实现，
 * 「拎出来的电视」和首页那台才不会是两种画面。
 *
 * 参考依据（逐项对齐，不是凭感觉调）：
 *  - tv.hzfe.org：银边 → 一圈厚倒角（上暗下亮）→ 桶形显示区；
 *    50%/5% 管面、白色 2px/4px 荧光行 + 20ms 微抖、4s 亮带、噪点滚动、关机坍缩。
 *  - toolv CRT 滤镜：扫描线 / 屏幕弧度 / RGB 偏移 / 辉光 / 暗角 / 噪点 / 闪烁 / 亮度。
 *
 * 分工：机壳开口那圈斜面（整圈连续环形，SLOPE_D + evenodd）由 CrtTv.tsx 的
 * .crt__bezel 常驻绘制，首屏就有、不依赖 WebGL；凸面曲线与描边都由 geometry.ts
 * 的 FRAME 一处生成。这里只画内框里的画面：桶形贴面变形 + toolv 那八项滤镜。
 * 外沿黑边也读同一份 FRAME，贴着凸面曲线走 —— 若改成「到画布矩形四边的
 * 距离」那种方框形等距线，会把曲线上下外鼓整段压平，凸面就白画了。
 */

import { CURVATURE, FRAME, TUBE_INSET } from './geometry';

export type TubeSource = HTMLVideoElement | HTMLCanvasElement | null;

export interface TubeFrame {
  a: TubeSource;
  b: TubeSource;
  /** 0 = 全 a，1 = 全 b；彩蛋双视频交叉溶解用 */
  mix: number;
}

/**
 * toolv 那八个滑块集中在这里调。
 * 机壳开口到凸面内框之间那圈斜面由 .crt__bezel 用 SVG 常驻绘制，不进着色器：
 * 首屏、WebGL 降级、彩蛋开机序列才有同一副边框，也不会出现硬明暗切线。
 */
export interface TubeParams {
  /** 屏幕弧度：内容贴面的外推量 */
  curvature: number;
  /** 扫描线强度 */
  scanline: number;
  /** RGB 水平偏移 */
  rgbShift: number;
  /** 荧光辉光 */
  bloom: number;
  /** 暗角 */
  vignette: number;
  /** 动态噪点 */
  noise: number;
  /** 刷新闪烁 */
  flicker: number;
  /** 亮度 */
  brightness: number;
  /** 荧光屏内边缘衰减：纯黑起点，相对画布短边的比例（不是玻璃外圈） */
  rimIn: number;
  /** 荧光屏内边缘衰减：渐淡终点，相对画布短边的比例 */
  rimOut: number;
}

export const TUBE_DEFAULTS: TubeParams = {
  curvature: CURVATURE,
  scanline: 0.34,
  rgbShift: 0.0022,
  bloom: 0.55,
  vignette: 0.16,
  noise: 0.035,
  flicker: 0.012,
  brightness: 1.18,
  // 玻璃外圈 2px 由 tv.css 的显示屏幕层负责，这里只做「荧光屏内部的边缘衰减」，
  // 顺带盖住 TUBE_INSET 越界露出的 clamp 列（左右橙/蓝竖线）。
  // 2026-11-14 收窄：旧值 2%/5% 相对短边约 13–33px，会冒充玻璃外圈，不符合显像管原理。
  rimIn: 0.004,
  rimOut: 0.014,
};

export interface TubeOptions {
  /** 首页 4:3 录像用 cover；彩蛋 1.75 片源用 contain，绝不裁两侧 */
  fit?: 'cover' | 'contain';
  params?: Partial<TubeParams>;
  reduceMotion?: boolean;
}

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG = `
precision highp float;
varying vec2 vUv;

uniform sampler2D uA;
uniform sampler2D uB;
uniform float uMix;
uniform float uTime;
uniform float uDpr;
uniform vec2  uFit;
uniform vec2  uRes;     /* 画布设备像素尺寸：黑边按物理像素算，不受 4:3 百分比拉伸影响 */
uniform vec2  uRim;     /* 纯黑终点 / 渐淡终点，设备像素，相对短边 */
uniform vec4  uFrame;   /* 凸面内框 (cornerX, cornerY, midX, midY)，与 CrtTv.tsx 同源 */

uniform float uCurv;
uniform float uScan;
uniform float uRgb;
uniform float uBloom;
uniform float uVign;
uniform float uNoise;
uniform float uFlicker;
uniform float uBright;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

/* 越界留一段软过渡：凸面把纹理坐标推到 [0,1] 之外一点点时，
   那一段正好被 .crt__bezel 的整圈连续斜面盖住，不该硬切成一道黑线。
   也不能改成 step() 硬判黑 —— 三个 RGB 通道会分别落在阶跃两侧，
   反而在边界烧出一条橙/蓝竖线。 */
float inBounds(vec2 s) {
  vec2 d = min(s, 1.0 - s);
  return smoothstep(-0.10, 0.006, min(d.x, d.y));
}

/* cover / contain 由 uFit 决定；越界返回黑，contain 的上下黑边就在这里出来 */
vec3 plate(vec2 uv) {
  vec2 s = (uv - 0.5) * uFit + 0.5;
  float m = inBounds(s);
  s = clamp(s, 0.0, 1.0);
  vec3 c = mix(texture2D(uA, s).rgb, texture2D(uB, s).rgb, uMix);
  return c * m;
}

/* 亮部往外晕开：六向抽样，单趟完成，不开第二个 framebuffer */
vec3 glow(vec2 uv) {
  vec3 sum = vec3(0.0);
  for (int i = 0; i < 6; i++) {
    float a = float(i) * 1.0471976;
    vec3 c = plate(uv + vec2(cos(a), sin(a)) * 0.011);
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    sum += c * max(l - 0.55, 0.0);
  }
  return sum * 0.1667;
}

void main() {
  /* 整块画布就是凸面内框里的显像区，边框归 CSS。
     qp 各轴独立归一化到 -1..1：内框是各边等比内缩的矩形，宽高比与整屏一致，
     所以 cover / contain 用整屏尺寸算出来仍然准确，只是画面被等比裁掉一圈。 */
  vec2 qp = (vUv - 0.5) * 2.0;
  float r2 = dot(qp, qp);

  /* 内容贴着凸面走：分轴桶形外推，越靠边单位屏幕像素吃进越多源像素
     （边缘压缩＝凸面）。弧度与 .crt__defs 的曲线同源。

     关键：CSS 内框只露出屏幕中间约 90%（外圈 5~11% 是斜面），所以纹理坐标
     要让「可见区」正对应完整源图 [0,1]，整屏则要略微越界 —— 越界那段藏在
     斜面底下。早先按四角最大系数做归一化（除以 1+warp）方向正好反了：
     uv 被收进 [0.05,0.95]，等于先把源图边缘 5% 丢掉，再被内框裁一圈，
     顶部 MARIO 分数与底部砖块就是这么没的。 */
  vec2 warped = vec2(
    qp.x * (1.0 + uCurv * qp.y * qp.y + 0.15 * uCurv * qp.x * qp.x),
    qp.y * (1.0 + uCurv * qp.x * qp.x + 0.15 * uCurv * qp.y * qp.y)
  );
  // 由 geometry.ts 一处注入：TUBE_INSET = 1 / (1 - 2*FRAME.midX)
  const float TUBE_INSET = ${TUBE_INSET.toFixed(4)};
  vec2 uv = warped * TUBE_INSET * 0.5 + 0.5;

  /* 八项滤镜。RGB 偏移只在水平方向，越靠边越明显（电子束到边角聚焦最差）。 */
  float ca = uRgb * (0.35 + 0.9 * r2);
  vec3 col;
  col.r = plate(uv + vec2(ca, 0.0)).r;
  col.g = plate(uv).g;
  col.b = plate(uv - vec2(ca, 0.0)).b;

  /* 荧光行：参考站是白色 2px 亮线 / 4px 周期 + 20ms 微抖，不是纯黑缝 */
  float y = gl_FragCoord.y / uDpr;
  float jitter = (fract(uTime * 50.0) - 0.5) * 0.6;
  float scan = 0.5 + 0.5 * cos((y + jitter) * 1.5707963);
  col *= 1.0 - uScan * 0.52 * (1.0 - scan);
  col += vec3(0.9, 0.95, 1.0) * uScan * 0.035 * scan;

  col += glow(uv) * uBloom;                                          // 辉光
  col *= 1.0 - uVign * smoothstep(0.28, 1.05, length(qp) * 0.82);    // 暗角（在可见区内就起效）
  col *= 1.0 + 0.055 * (1.0 - r2 * 0.6);                             // 凸面中间受光

  float grain = hash(gl_FragCoord.xy + vec2(uTime * 97.0, uTime * 57.0)) - 0.5;
  col += grain * uNoise;                                             // 噪点
  float pos = 1.2 - fract(uTime / 4.0) * 2.4;                        // 4s 一条亮带自上而下
  col += vec3(0.045, 0.043, 0.038) * exp(-pow((qp.y - pos) * 6.0, 2.0));
  col *= 1.0 + uFlicker * sin(uTime * 41.0) + uFlicker * 0.5 * sin(uTime * 13.0); // 闪烁

  float luma = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(luma), col, 1.18);                                   // 提饱和
  col *= uBright;
  col = pow(max(col, 0.0), vec3(0.94));

  /* 玻璃反光只留极淡一层：中心柔光 + 左上斜光。
     顶部那道灰白弧面聚光会读成「套了个亮框」，参考图里没有，去掉。 */
  float spec = pow(max(0.0, 1.0 - r2 * 0.55), 3.0);
  col += vec3(0.022, 0.021, 0.018) * spec;
  col += vec3(0.012, 0.011, 0.010) * smoothstep(0.2, 1.0, -qp.x * 0.7 - qp.y * 0.7) * (1.0 - r2 * 0.4);

  /* 外沿黑边贴着「凸面内框曲线」走，而不是到画布矩形四边的等距线：
     方框形等距线会把曲线上下外鼓的那一段整片压黑，凸面就白画了。
     曲线是三次贝塞尔 C .30/.70，其中点只走到控制点权重的 0.75，
     所以 0.75*bell（bell=4t(1-t)）与 clipPath 的中点严格同位置。
     uFrame 与 CrtTv.tsx 的 FRAME 同源，改弧度两边一起变。
     靠画面一侧 smoothstep 渐淡，纯黑段顺带盖住 TUBE_INSET 越界
     露出的 clamp 拉伸列（左右那条橙/蓝竖线）。 */
  vec2 v = vUv;
  float bellX = 4.0 * v.x * (1.0 - v.x);
  float bellY = 4.0 * v.y * (1.0 - v.y);
  float insetX = mix(uFrame.x, uFrame.z, 0.75 * bellY);
  float insetY = mix(uFrame.y, uFrame.w, 0.75 * bellX);
  vec2 dPx = vec2(
    (min(v.x, 1.0 - v.x) - insetX) * uRes.x,
    (min(v.y, 1.0 - v.y) - insetY) * uRes.y
  );
  col *= smoothstep(uRim.x, uRim.y, min(dPx.x, dPx.y));

  gl_FragColor = vec4(col, 1.0);
}`;

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

function makeTexture(gl: WebGLRenderingContext) {
  const tex = gl.createTexture();
  if (!tex) return null;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
  return tex;
}

export interface TubeHandle {
  /** 暂停 / 恢复绘制。关机后画面只是一条亮线，继续跑 GL 纯属烧电。 */
  setActive: (on: boolean) => void;
  /** 停 rAF、断观察、释放上下文 */
  dispose: () => void;
}

/**
 * 把管面挂到 canvas 上。WebGL 不可用时返回 null，调用方保留 <video> 直接可见的降级画面。
 */
export function mountTube(
  canvas: HTMLCanvasElement,
  frame: () => TubeFrame,
  opts: TubeOptions = {},
): TubeHandle | null {
  const gl = canvas.getContext('webgl', {
    alpha: false,
    antialias: false,
    depth: false,
    powerPreference: 'low-power',
  }) as WebGLRenderingContext | null;
  if (!gl) return null;

  // 降级路径也要把 GL 资源还回去：Chrome 单页 WebGL 上下文上限约 16，比 AudioContext 更紧，
  // 每页漏一个，反复进出首页很快就能把设备顶满。
  const bail = (shaders: WebGLShader[], prog?: WebGLProgram | null, texes: WebGLTexture[] = []): null => {
    for (const t of texes) gl.deleteTexture(t);
    if (prog) gl.deleteProgram(prog);
    for (const s of shaders) gl.deleteShader(s);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return null;
  };

  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return bail([vs, fs].filter((s): s is WebGLShader => !!s));
  const prog = gl.createProgram();
  if (!prog) return bail([vs, fs]);
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return bail([vs, fs], prog);
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'aPos');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const texA = makeTexture(gl);
  const texB = makeTexture(gl);
  if (!texA || !texB) {
    return bail([vs, fs], prog, [texA, texB].filter((t): t is WebGLTexture => !!t));
  }
  // 常量状态，设一次就够；每帧重设只是白跑一次 GL 调用
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);

  const u = (n: string) => gl.getUniformLocation(prog, n);
  const uMix = u('uMix');
  const uTime = u('uTime');
  const uDpr = u('uDpr');
  const uFit = u('uFit');
  const uRes = u('uRes');
  const uRim = u('uRim');
  gl.uniform1i(u('uA'), 0);
  gl.uniform1i(u('uB'), 1);

  const p: TubeParams = { ...TUBE_DEFAULTS, ...(opts.params ?? {}) };
  gl.uniform1f(u('uCurv'), p.curvature);
  gl.uniform1f(u('uScan'), p.scanline);
  gl.uniform1f(u('uRgb'), p.rgbShift);
  gl.uniform1f(u('uBloom'), p.bloom);
  gl.uniform1f(u('uVign'), p.vignette);
  gl.uniform1f(u('uNoise'), p.noise);
  gl.uniform1f(u('uFlicker'), opts.reduceMotion ? 0 : p.flicker);
  gl.uniform1f(u('uBright'), p.brightness);
  gl.uniform4f(u('uFrame'), FRAME.cornerX, FRAME.cornerY, FRAME.midX, FRAME.midY);

  let w = 0;
  let h = 0;
  let dpr = 1;
  const resize = () => {
    dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    const cw = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const ch = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (cw === w && ch === h) return;
    w = cw;
    h = ch;
    canvas.width = cw;
    canvas.height = ch;
    gl.viewport(0, 0, cw, ch);
    gl.uniform1f(uDpr, dpr);
    gl.uniform2f(uRes, cw, ch);
    const shortSide = Math.min(cw, ch);
    gl.uniform2f(uRim, p.rimIn * shortSide, p.rimOut * shortSide);
  };
  resize();
  // 尺寸改由观察器驱动：draw() 里每帧读 clientWidth 等于每帧问一次布局。
  // RO 回调在布局之后，拿到的就是最新值；窗口缩放（含 DPR / 系统缩放的抖动）
  // 不一定改变 canvas 的 CSS 盒，另挂一次 resize 兜底。
  const ro = new ResizeObserver(() => resize());
  ro.observe(canvas);
  window.addEventListener('resize', resize, { passive: true });

  const sourceSize = (src: Exclude<TubeSource, null>): [number, number] =>
    src instanceof HTMLVideoElement ? [src.videoWidth, src.videoHeight] : [src.width, src.height];

  // 同一帧不重复上传。视频暂停时 currentTime 不变，画面也没变，传一遍几十万像素
  // 纯属白烧 GPU 带宽 —— 整段影片里 mix===0 / 1 的时间占九成以上。
  // 带上 currentSrc：换源后同一个 currentTime 是新画面，不能当旧帧跳过。
  const lastFrames = new WeakMap<HTMLVideoElement, { src: string; t: number }>();
  const upload = (unit: number, tex: WebGLTexture, src: TubeSource) => {
    if (!src) return;
    if (src instanceof HTMLVideoElement) {
      if (src.readyState < 2 || !src.videoWidth) return;
      const prev = lastFrames.get(src);
      if (prev && prev.src === src.currentSrc && prev.t === src.currentTime) return;
      lastFrames.set(src, { src: src.currentSrc, t: src.currentTime });
    }
    const [sw, sh] = sourceSize(src);
    if (!sw || !sh) return;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
  };

  const fit = [1, 1];
  const fitFor = (src: TubeSource) => {
    if (!src || !w || !h) return;
    const [sw, sh] = sourceSize(src);
    if (!sw || !sh) return;
    const va = sw / sh;
    const ca = w / h;
    if (opts.fit === 'contain') {
      if (va >= ca) {
        fit[0] = 1;
        fit[1] = va / ca;
      } else {
        fit[0] = ca / va;
        fit[1] = 1;
      }
    } else if (va >= ca) {
      fit[0] = ca / va;
      fit[1] = 1;
    } else {
      fit[0] = 1;
      fit[1] = va / ca;
    }
  };

  let raf = 0;
  let dead = false;
  /** 调用方是否还要画面（首页关机 → false）。`opacity:0` 的元素依旧算 intersecting，光靠 IO 停不下来。 */
  let active = true;
  /** 是否在视口内，由 IntersectionObserver 维护 */
  let visible = true;
  const draw = (now: number) => {
    raf = 0;
    if (dead || !active) return;
    const f = frame();
    // 交叉溶解时两路都要；平时只有一路有内容，另一路是静止帧，不必上传
    if (f.mix < 1) upload(0, texA, f.a);
    if (f.mix > 0) upload(1, texB, f.b);
    fitFor(f.mix < 0.5 ? f.a || f.b : f.b || f.a);
    gl.uniform2f(uFit, fit[0], fit[1]);
    gl.uniform1f(uMix, Math.max(0, Math.min(1, f.mix)));
    gl.uniform1f(uTime, opts.reduceMotion ? 0 : now / 1000);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    raf = requestAnimationFrame(draw);
  };

  // 滚出视口就停，别在看不见的地方空转 GPU
  const io = new IntersectionObserver(
    ([e]) => {
      visible = e.isIntersecting;
      if (visible && active && !raf && !dead) raf = requestAnimationFrame(draw);
      else if (!visible && raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    },
    { threshold: 0 },
  );
  io.observe(canvas);

  const onLost = (e: Event) => {
    e.preventDefault();
    dead = true;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };
  canvas.addEventListener('webglcontextlost', onLost);

  return {
    setActive: (on: boolean) => {
      if (on === active) return;
      active = on;
      if (active) {
        if (!dead && visible && !raf) raf = requestAnimationFrame(draw);
      } else if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    },
    dispose: () => {
      dead = true;
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('resize', resize);
      io.disconnect();
      canvas.removeEventListener('webglcontextlost', onLost);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}
