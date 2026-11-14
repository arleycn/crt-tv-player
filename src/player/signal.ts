/**
 * 彩蛋信号画面与显示层文本：测试卡 SVG、无信号雪花、状态文案、时长与转义。
 * 纯输出，不读编排、不认播放状态。
 */
/** 经典测试卡：灰网格 + 中央圆 + 七色条 / 灰阶 / 黑白格。内联 SVG，零额外请求。 */
export const BARS_SVG = `
<svg class="tv__bars-svg" viewBox="0 0 960 540" preserveAspectRatio="xMidYMid slice" shape-rendering="crispEdges" aria-hidden="true">
  <defs><clipPath id="tv-circle"><circle cx="480" cy="270" r="234"/></clipPath></defs>
  <rect width="960" height="540" fill="#7a7a7a"/>
  <g stroke="#9a9a9a" stroke-width="1" fill="none">
    <path d="M0 54H960M0 108H960M0 162H960M0 216H960M0 324H960M0 378H960M0 432H960M0 486H960"/>
    <path d="M48 0V540M96 0V540M144 0V540M816 0V540M864 0V540M912 0V540"/>
  </g>
  <g>
    <rect x="48" y="54" width="48" height="108" fill="#1b1bc8"/><rect x="96" y="54" width="48" height="108" fill="#dede1e"/>
    <rect x="48" y="270" width="48" height="216" fill="#1ec81e"/><rect x="96" y="378" width="48" height="108" fill="#c81e1e"/>
    <rect x="816" y="54" width="48" height="108" fill="#1b1bc8"/><rect x="864" y="54" width="48" height="108" fill="#dede1e"/>
    <rect x="816" y="270" width="48" height="216" fill="#1ec81e"/><rect x="864" y="378" width="48" height="108" fill="#c81e1e"/>
  </g>
  <circle cx="480" cy="270" r="234" fill="#e6e6e6"/>
  <g clip-path="url(#tv-circle)">
    <rect x="246" y="36" width="67" height="156" fill="#bfbfbf"/><rect x="313" y="36" width="67" height="156" fill="#bfbf00"/>
    <rect x="380" y="36" width="67" height="156" fill="#00bfbf"/><rect x="447" y="36" width="67" height="156" fill="#00bf00"/>
    <rect x="514" y="36" width="67" height="156" fill="#bf00bf"/><rect x="581" y="36" width="67" height="156" fill="#bf0000"/>
    <rect x="648" y="36" width="67" height="156" fill="#0000bf"/>
    <rect x="246" y="192" width="469" height="54" fill="#0a0a0a"/>
    <rect x="246" y="192" width="67" height="54" fill="#e6e6e6"/><rect x="380" y="192" width="67" height="54" fill="#e6e6e6"/>
    <rect x="514" y="192" width="67" height="54" fill="#e6e6e6"/><rect x="648" y="192" width="67" height="54" fill="#e6e6e6"/>
    <rect x="246" y="246" width="67" height="114" fill="#1a1a1a"/><rect x="313" y="246" width="67" height="114" fill="#4a4a4a"/>
    <rect x="380" y="246" width="67" height="114" fill="#7a7a7a"/><rect x="447" y="246" width="67" height="114" fill="#a8a8a8"/>
    <rect x="514" y="246" width="67" height="114" fill="#d6d6d6"/><rect x="581" y="246" width="67" height="114" fill="#f2f2f2"/>
    <rect x="648" y="246" width="67" height="114" fill="#0a0a0a"/>
    <rect x="246" y="360" width="469" height="144" fill="#101010"/>
    <rect x="270" y="392" width="80" height="80" fill="#d8d800"/><rect x="360" y="392" width="80" height="80" fill="#00d8d8"/>
    <rect x="450" y="392" width="80" height="80" fill="#00d800"/><rect x="540" y="392" width="80" height="80" fill="#d800d8"/>
    <rect x="630" y="392" width="80" height="80" fill="#d80000"/>
  </g>
</svg>`;

/** 无信号雪花：低分辨率随机灰度，放大后就是老电视的粗颗粒。
 *  约 15fps、192 列，视频就绪后立刻停笔，不空耗 CPU。 */
export function startSnow(
  canvas: HTMLCanvasElement,
  reduce: boolean,
  signal: AbortSignal,
  box?: HTMLElement | null,
): () => void {
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return () => {};
  // 雪花按承载它的盒子（电视屏幕 or 整层）比例生成；桌面端 box 为 root=整视口，行为同旧
  const cw = box?.clientWidth || window.innerWidth;
  const ch = box?.clientHeight || window.innerHeight;
  const w = 192;
  const h = Math.max(64, Math.round((w * ch) / Math.max(1, cw)));
  canvas.width = w;
  canvas.height = h;
  const img = ctx.createImageData(w, h);
  let raf = 0;
  let last = 0;
  let stopped = false;

  const paint = () => {
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const v = (Math.random() * 256) | 0;
      d[i] = v;
      d[i + 1] = v;
      d[i + 2] = v;
      d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  };

  const tick = (t: number) => {
    if (stopped || signal.aborted) return;
    if (t - last >= 66) {
      last = t;
      paint();
    }
    raf = requestAnimationFrame(tick);
  };

  paint(); // 先出一帧，避免首帧空白
  if (!reduce) raf = requestAnimationFrame(tick);
  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
  };
}

/** 片单与状态文案。全部按老电视的口吻写：不说「加载失败 / 出错」，说「信号飘走了」。
 *  这几句是唯一对外的异常措辞，改文案只改这里。 */
export const NOTE = {
  idle: '右边片单里挑一部',
  wait: '正在接收信号…',
  slow: '信号有点弱，再等等…',
  lost: '这一段信号飘走了',
  cut: '信号断了，先换一部',
  sound: '轻点屏幕 · 开启声音',
  power: '按电源键通电',
};

export function fmtDuration(sec?: number): string {
  if (!sec || !Number.isFinite(sec)) return '';
  const total = Math.max(0, Math.round(sec));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
}
