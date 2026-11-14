import type { ComponentChildren, Ref } from 'preact';
import { FRAME } from './geometry';

/**
 * 全站唯一一台 CRT 电视机。
 *
 * 页面渲染 <CrtTv>，屏幕内容由播放器在挂载时注入。所有曲线几何只在这里定义一次：
 *   · CrtDefs  → 凸面裁剪曲线 + 斜面渐变（全页一份，放在 .crt 之外，避免克隆出重复 ID）
 *   · CrtBezel → 机壳斜面（父层）：外框 → INNER_D 内沿的一整圈连续碗面
 *   · CrtGlass → 玻璃外圈沿凸面曲线的实体过渡带（显示屏幕层）
 *   · 外壳/下巴 → 塑料壳、电源键、指示灯、喇叭槽
 * 样式只在 src/player/tv.css 一份；桌面/手机各自改那个文件里的对应断点。
 *
 * 零件装配（2026-11-14 用户按实物图订正，父子关系不许再倒回去）：
 *   【机壳】.crt__frame → .crt__bezel（外壳向内收的斜面，机壳一体，
 *                          唯一 4:3 坐标盒 + 塑料唇/暖光等机壳外观）
 *                       → .crt__chin（下巴）
 *   【机壳开口】.crt__bezel > .crt__aperture：斜面内沿 INNER_D 围出的「洞」，
 *              clip-path 裁成曲线，只装玻璃底色，不承载坐标盒、不承载机壳外观。
 *   【显示屏幕】.crt__aperture > .crt__display > glass + screen：嵌进洞里的另一件零件。
 *
 * 实物顺序是「机壳 → 斜面 → 开口（洞）→ 显示屏」，所以斜面必须是父、开口必须是子；
 * 反过来就会变成「屏幕铺满外框、斜面板盖在屏幕前面」，读起来不是屏幕沉进凹槽。
 *
 * 分工：本文件只管「形状」——机壳曲线与玻璃边的轮廓。玻璃外圈 2px /
 * 淡入带 1px 是 CSS 物理尺寸，归 tv.css，由荧光屏盒子的 inset 与内容边缘
 * 渐变实现；这里不再画第二套 mask/filter。玻璃过渡带用「沿曲线的描边」
 * 而不是矩形渐变：凸面曲线在上下边中点内缩约 5.4%，从矩形边缘往里量的
 * 渐变会整段落在曲线外、被裁掉，等于没画。
 */

/**
 * 内框几何全部从 player/geometry.ts 的 FRAME 读（着色器的外沿黑边也读同一份）。
 * clipPath 用 objectBoundingBox，x 百分比相对宽度、y 百分比相对高度；
 * FRAME 已按 4:3 把横向基准换算到纵向，四边黑边在物理像素上才等宽。
 */
const CX = FRAME.cornerX * 100;   // %W  四角横向内缩
const SM = FRAME.midX * 100;      // %W  左右边中内缩
const CY = FRAME.cornerY * 100;   // %H  四角纵向内缩
const TM = FRAME.midY * 100;      // %H  上边中内缩（比左右更外凸）
const BM = TM;                    // %H  下边中内缩
const f = (n: number): string => String(Number(n.toFixed(4)));
const p = (n: number): string => f(n / 100); // objectBoundingBox 用 0..1

/**
 * 内框凸面曲线（外框大矩形 → 凸面内框）只有一条：INNER_D。
 * 它同时服务三处，不许另写第二份：
 *   · CrtDefs 的 #crt-curve（clipPath，0..1）→ 画面按它裁切，永不越过斜面
 *   · CrtGlass 的玻璃描边（0..100）→ 屏幕内沿那圈玻璃实体
 *   · CrtBezel 的 SLOPE_D（外矩形 − INNER_D 的环形，0..100）→ 一整圈连续斜面
 * 四角已是三次贝塞尔的圆润内收（控制点在 30/70 与 SM/TM，左右上下对称），
 * 不再用二次贝塞尔退化直线，也不再把斜面切成四片梯形去硬拼 —— 那样四片
 * 交接处必有对角缝 / 花瓣角，正是用户实图对比后指出「哪里不太对」的根因。
 */
const INNER_D =
  `M${f(CX)} ${f(CY)}C30 ${f(TM)} 70 ${f(TM)} ${f(100 - CX)} ${f(CY)}` +
  `C${f(100 - SM)} 30 ${f(100 - SM)} 70 ${f(100 - CX)} ${f(100 - CY)}` +
  `C70 ${f(100 - BM)} 30 ${f(100 - BM)} ${f(CX)} ${f(100 - CY)}` +
  `C${f(SM)} 70 ${f(SM)} 30 ${f(CX)} ${f(CY)}Z`;

/** clipPath 用的 0..1 坐标（objectBoundingBox），与 INNER_D 同源同形。 */
const EDGE_ALL =
  `M${p(CX)} ${p(CY)} C0.30 ${p(TM)} 0.70 ${p(TM)} ${p(100 - CX)} ${p(CY)} ` +
  `C${p(100 - SM)} 0.30 ${p(100 - SM)} 0.70 ${p(100 - CX)} ${p(100 - CY)} ` +
  `C0.70 ${p(100 - BM)} 0.30 ${p(100 - BM)} ${p(CX)} ${p(100 - CY)} ` +
  `C${p(SM)} 0.70 ${p(SM)} 0.30 ${p(CX)} ${p(CY)} Z`;

/**
 * 斜面 = 一整圈连续环形：外矩形（机壳开口，由 .crt__aperture 的 overflow
 * 圆角裁成圆角）减去内凸面曲线，fill-rule:evenodd 填成一圈。
 * 真实老电视的斜面就是这样一整圈连贯的碗状曲面，没有四片对角拼缝；
 * 四个角的「斜面变宽」是自然出现的（内曲线在角上比边中多收一截），
 * 不是用四块梯形硬拼出来的花瓣角。
 */
const SLOPE_D = `M0 0 H100 V100 H0 Z ${INNER_D}`;

/**
 * 曲线定义必须放在页面根部、.crt 之外：触发彩蛋时首页那台会被 visibility:hidden，
 * 放电视里 clipPath 会一起失效；克隆后还会出现重复 ID。
 * Home 在页面最外层渲染一次即可，彩蛋克隆体引用的是同一份。
 *
 * 只有一份 #crt-curve（clipPath）与两条斜面渐变，没有 mask / filter：
 * 玻璃外圈是显示屏幕的一部分，由 tv.css 的盒子与渐变画，不是盖在视频上的滤镜。
 */
export function CrtDefs() {
  return (
    <svg class="crt__defs" focusable="false" aria-hidden="true">
      <defs>
        <clipPath id="crt-curve" clipPathUnits="objectBoundingBox">
          <path d={EDGE_ALL} />
        </clipPath>
        {/* 斜面连续渐变：径向碗状深度 + 上下方向光。定义一次全页共用，
            彩蛋克隆体引用同一份，不重复 ID（页面根，不在 .crt 内）。 */}
        <radialGradient id="crt-slope-depth" cx="50%" cy="43%" r="76%">
          <stop offset="0%" stop-color="#2c241b" />
          <stop offset="56%" stop-color="#15110c" />
          <stop offset="100%" stop-color="#070504" />
        </radialGradient>
        <linearGradient id="crt-slope-light" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="rgba(255,246,228,0.12)" />
          <stop offset="52%" stop-color="rgba(255,246,228,0)" />
          <stop offset="100%" stop-color="rgba(0,0,0,0.24)" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/**
 * 机壳斜面：外壳向屏幕内收的一整圈连续碗面，不是四片梯形。
 *
 * 这层是「父」——它包着 .crt__aperture 那个洞，也是整机唯一的 4:3 坐标盒，
 * 塑料唇 / 受光 / 暖光等机壳外观全归它。整圈环形 = 外矩形 − 内凸面曲线
 * （SLOPE_D，fill-rule:evenodd），四角天然对称、无对角缝；内框那圈亮唇交给
 * CrtGlass 沿同一条 INNER_D 描边负责，这里不重复画。
 * 常驻 DOM（不归 WebGL），首屏 / 降级 / 开机雪花 / 影片阶段同一副边框。
 *
 * 只有 svg 是装饰：整块 div 不能加 aria-hidden，否则挂在它下面的显示屏幕
 * 会被读屏一起隐藏。children 就是那个洞（及其里面的显示屏幕）。
 */
export function CrtBezel({ children }: { children?: ComponentChildren }) {
  return (
    <div class="crt__bezel">
      <svg class="crt__slope" viewBox="0 0 100 100" preserveAspectRatio="none" focusable="false" aria-hidden="true">
        <path class="crt__slope-fill" d={SLOPE_D} fill-rule="evenodd" fill="url(#crt-slope-depth)" />
        <path class="crt__slope-fill" d={SLOPE_D} fill-rule="evenodd" fill="url(#crt-slope-light)" />
      </svg>
      {children}
    </div>
  );
}

/**
 * 显示屏幕层的玻璃外圈：沿「凸面内框曲线」描边，不是矩形渐变。
 *
 * 为什么必须描边：凸面曲线在上下边中点内缩 midY≈5.4%、左右边中点内缩
 * midX≈5.07%，四角内缩 8.8%。从矩形四边往里量的 linear-gradient 会整段
 * 落在曲线之外、被 clip-path 裁掉 —— 这正是早先「玻璃外圈只有 2px、开机
 * 雪花态完全读不出来」的根因。描边天生贴着曲线，四个状态都一致。
 *
 * 三层描边由宽到窄叠出淡入淡出：外侧 1px 不显影的玻璃实体 + 往荧光屏
 * 方向渐淡的过渡带。整层被 .crt__glass 的 #crt-curve 裁切，所以只画在
 * 曲线内侧、绝不越到机壳斜面上；视频本身仍只住在 .crt__screen 里。
 * vector-effect=non-scaling-stroke 让描边宽度是真实 CSS 像素，不受
 * preserveAspectRatio="none" 的 4:3 拉伸影响（否则横竖宽度会差 1/3）。
 */
export function CrtGlass() {
  return (
    <div class="crt__glass" aria-hidden="true">
      <svg class="crt__glass-edge" viewBox="0 0 100 100" preserveAspectRatio="none" focusable="false">
        <path class="crt__glass-edge--halo" d={INNER_D} />
        <path class="crt__glass-edge--fade" d={INNER_D} />
        <path class="crt__glass-edge--core" d={INNER_D} />
      </svg>
    </div>
  );
}

interface CrtTvProps {
  children?: ComponentChildren;
  /** 挂到整机 .crt 上的 ref，供播放器拿到这台电视的元素。 */
  tvRef?: Ref<HTMLDivElement>;
  /** 首屏是否已通电。默认 false = 待机，需按电源键开机（浏览器有声自动播放要求手势）。 */
  on?: boolean;
}

/**
 * 彩蛋那台点播机多出来的四颗键：换台 ∧∨、音量 +−。
 *
 * 换台按三角本身的朝向走：▲ 往片单上方走一格 = 上一台，▼ 往下方走一格 = 下一台。
 * （data-knob 记的是「哪颗键」，不是「往哪走」，所以 ch-up 绑的是 tuneBy(-1)。）
 *
 * 首页只有电源键 —— 那儿是一段静音循环录像，装一排换台/音量就是假控件。
 * 进了播放器这台电视才真的在放片子，四颗键才成立，所以由播放器在挂载时
 * 注入这份 markup：机器只有一台，不能因为「首页不放」就让两处各写一套。
 * 样式与电源键共用 .crt__chin .knob 那层塑料（src/player/tv.css）。
 */
export const CRT_KEYS_HTML = `
  <span class="crt__keys" role="group" aria-label="换台与音量">
    <span class="crt__keys-pair">
      <button type="button" class="knob knob--soft knob--ch" data-knob="ch-up" aria-label="换到上一个台" title="上一个台">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6.6 19 15.9H5z"/></svg>
      </button>
      <button type="button" class="knob knob--soft knob--ch" data-knob="ch-down" aria-label="换到下一个台" title="下一个台">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 17.4 5 8.1h14z"/></svg>
      </button>
    </span>
    <span class="crt__keys-pair">
      <button type="button" class="knob knob--soft knob--vol" data-knob="vol-up" aria-label="调大音量" title="音量加">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6.4v11.2M6.4 12h11.2"/></svg>
      </button>
      <button type="button" class="knob knob--soft knob--vol" data-knob="vol-down" aria-label="调小音量" title="音量减">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.4 12h11.2"/></svg>
      </button>
    </span>
  </span>
`;

/**
 * 整机按零件装配（2026-11-14 用户按实物图订正父子关系）：
 *   【机壳】.crt__frame（塑料壳 + padding 壳厚）
 *          └ .crt__bezel（外壳向内收的斜面：唯一 4:3 坐标盒 + 圆角 + 机壳外观）
 *             └ .crt__aperture（斜面内沿围出的洞：曲线裁切 + 暗玻璃底色）
 *                └ .crt__display（嵌进洞的显示管）
 *                   ├ .crt__glass  玻璃外圈 2px 不发光 + 反光 / CRT 元素
 *                   └ .crt__screen 荧光屏：内收的内容盒，视频 / 信号 / OSD 只画在这里
 *          └ .crt__chin（下巴，机壳的一部分）
 *
 * 关键：斜面是父、开口是子。开口只表示「洞」，坐标盒与机壳外观都上提到斜面，
 * 玻璃与荧光屏属于另一件零件，另起 .crt__display 收拢。
 * 洞与显示屏幕共用斜面这一个坐标盒（inset:0 贴齐），不引入第二套要手对齐的坐标。
 *
 * 视频不论源尺寸多大，都只在荧光屏内按 contain 显示，绝不铺满显示屏幕再被
 * 玻璃圈盖住 —— 那不符合显像管原理。4:3 与凸面弧度由 FRAME 一处决定。
 */
export function CrtTv({ children, tvRef, on = false }: CrtTvProps) {
  return (
    <div
      class={`crt${on ? '' : ' is-off'}`}
      // 这台电视是氛围道具：整台不弹右键、不拖出文件，也不给选中文字。
      // Edge 的「文本选择迷你菜单」由 selection 触发、不走 contextmenu，
      // 连点 10 次会被当成双击选词；user-select:none 在 tv.css 里从源头掐掉文本选择。
      onContextMenu={(e) => e.preventDefault()}
      onDragStart={(e) => e.preventDefault()}
      ref={tvRef}
    >
      <div class="crt__frame">
        {/* 【机壳斜面】外壳向内收的碗面，与 frame 一体。壳厚由 frame 的 padding 一处决定；
            唯一 4:3 坐标盒、圆角与机壳外观都在这一层。 */}
        <CrtBezel>
          {/* 【机壳开口】斜面内沿 INNER_D 围出的洞：clip-path 裁成曲线，
              只装不发光暗玻璃底色，不再是坐标盒、不承载机壳外观。 */}
          <div class="crt__aperture">
            {/* 【显示屏幕】嵌进洞里的另一件零件，inset:0 贴齐这个口。 */}
            <div class="crt__display">
              {/* 玻璃：外圈不发光的一圈 + 反光，属于显示管玻璃。 */}
              <CrtGlass />
              {/* 荧光屏：内收的内容盒（tv.css 的 --crt-glass-ring / --crt-glass-fade）。
                  video / canvas / 开机信号层 / OSD 全部只装在这里。 */}
              <div class="crt__screen">
                {children}
              </div>
            </div>
          </div>
        </CrtBezel>
        {/* 下巴只留左侧一颗电源键 + 一盏指示灯；右端喇叭槽是纯造型，不放文字。
            首页录像静音，这里不该有换台/音量键（见上面的 CRT_KEYS_HTML）。 */}
        <div class="crt__chin">
          <button
            type="button"
            class="knob knob--power"
            aria-pressed={on ? 'true' : 'false'}
            aria-label={on ? '关闭小电视' : '打开小电视'}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 3.4v7.2" />
              <path d="M6.9 6.9a7.2 7.2 0 1 0 10.2 0" />
            </svg>
          </button>
          <span class="dot" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}
