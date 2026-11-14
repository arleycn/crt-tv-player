/**
 * 电视舞台的几何：首帧同步布局（main.tsx）与播放器内的让位重排（player.ts）共用，
 * 缩放公式只在这里定义一次，避免两处各算一套导致冷启动跳一下。
 */
export interface StageGeom {
  cw: number;
  naturalH: number;
}
export interface TvTransform {
  tx: number;
  ty: number;
  scale: number;
}

/** transform 不改变 layout 尺寸，所以缩放后再读仍是电视的自然尺寸。 */
export function stageGeom(stage: HTMLElement): StageGeom {
  return { cw: stage.offsetWidth || 560, naturalH: stage.offsetHeight || 464 };
}

export function tvTransform(
  geom: StageGeom,
  vw: number,
  vh: number,
  reserveRight: number,
  reserveBottom: number,
): TvTransform {
  const availW = Math.max(240, vw - reserveRight);
  const availH = Math.max(200, vh - reserveBottom);
  const chrome = Math.max(40, Math.min(96, availH * 0.16));
  const scale = Math.min((availW - 4) / geom.cw, (availH - chrome) / Math.max(1, geom.naturalH));
  const tw = geom.cw * scale;
  const th = geom.naturalH * scale;
  return {
    tx: Math.max(0, (availW - tw) / 2),
    ty: Math.max(0, (availH - th) / 2),
    scale,
  };
}

export function applyTvTransform(
  stage: HTMLElement,
  t: TvTransform,
  animate: boolean,
  reduce: boolean,
): void {
  stage.style.transition = animate && !reduce ? 'transform 520ms var(--ease)' : 'none';
  stage.style.transform = `translate(${t.tx}px, ${t.ty}px) scale(${t.scale})`;
}

export const isNarrow = (): boolean => window.matchMedia('(max-width: 900px)').matches;

/** 片单尺寸只由 CSS 决定：插一个隐形探针量真实 offsetWidth/offsetHeight，
 *  不把 clamp(268px, 23vw, 340px) / min(46vh, 400px) 复制进 JS。
 *  探针挂在 .crtv 内、此时没有 is-stations，opacity:0 且 fixed 不占布局流。 */
function measureDial(root: HTMLElement): { w: number; h: number } {
  const probe = document.createElement('aside');
  probe.className = 'tv__dial';
  probe.setAttribute('aria-hidden', 'true');
  root.appendChild(probe);
  const w = probe.offsetWidth;
  const h = probe.offsetHeight;
  probe.remove();
  return { w, h };
}

/** 「片单展开后」要预留的可用区：片单还没建出来时也能算最终位置。 */
export function stationReserves(root: HTMLElement): { right: number; bottom: number } {
  const { w, h } = measureDial(root);
  const narrow = isNarrow();
  return { right: narrow ? 0 : w + 22, bottom: narrow ? h + 10 : 0 };
}

/** 浏览器首次绘制之前同步调用，杜绝「左上角未缩放小电视 → 放大居中」那段跳变。
 *  withDial=true  直接落在「片单展开后」的最终位置（autoBoot 模式，片单随页面出现）。
 *  withDial=false 落在整个视口正中（显式通电模式）：待机时还没有片单，
 *  通电后片单淡入，再由 layoutStations(true) 带 520ms 让位动画挪过去。 */
export function layoutStageFirstPaint(
  stage: HTMLElement,
  root: HTMLElement,
  withDial = true,
): void {
  const { right, bottom } = withDial ? stationReserves(root) : { right: 0, bottom: 0 };
  applyTvTransform(
    stage,
    tvTransform(stageGeom(stage), window.innerWidth, window.innerHeight, right, bottom),
    false,
    true,
  );
}
