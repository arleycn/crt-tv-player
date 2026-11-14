/**
 * 显示管玻璃层的运行时入口：只认「给我一个画面源」，不认片源。
 *
 * 机壳（.crt__frame / .crt__bezel / .crt__chin）归 CrtTv.tsx + tv.css，
 * 从头到尾不碰画面、不碰控制；本文件只管玻璃层：管面画布、挂载、
 * is-live / is-tube / is-fallback 状态类、停帧与释放。
 *
 * 页面（Preact）与纯 DOM 调用方都从这里接画面，不再各自调 mountTube：
 * 挂载 / 降级 / 清理只有一套语义，也不会出现「一边清了状态类、另一边没清」。
 * 片源从哪来、何时换片、音量、OSD，一律不在这里，也别把 URL 塞进来。
 */
import {
  mountTube,
  type TubeFrame,
  type TubeHandle,
  type TubeOptions,
  type TubeSource,
} from './tube';

export type { TubeFrame, TubeSource } from './tube';

export interface TubeViewOptions extends TubeOptions {
  /** 显示管状态类（is-tube / is-fallback）挂点：默认机壳开口（洞）。
   *  传 null = 不管理这两个状态位，由编排层自己管。 */
  stateHost?: HTMLElement | null;
  /** 新建画布时追加的 class，例如 crt__tube--player。 */
  canvasClass?: string;
}

export interface TubeView {
  readonly canvas: HTMLCanvasElement;
  /** 单个 media 或「每帧给两路画面」的回调；挂上 WebGL 返回 true，降级返回 false。 */
  attach(source: TubeSource | (() => TubeFrame)): boolean;
  /** 停帧 / 恢复，不重建管面。 */
  setActive(on: boolean): void;
  /** 幂等：停 rAF、释放上下文、清状态类。 */
  detach(): void;
}

const isFrameFn = (s: TubeSource | (() => TubeFrame)): s is () => TubeFrame =>
  typeof s === 'function';

/**
 * target 可以是现成画布（首页 JSX / 彩蛋克隆体），也可以是荧光屏容器 ——
 * 后者自动建一块 .crt__tube 画布，让「塞一个本地视频就播」不必先懂整机 DOM。
 */
export function createTubeView(
  target: HTMLCanvasElement | HTMLElement,
  opts: TubeViewOptions = {},
): TubeView {
  const { stateHost: customHost, canvasClass, ...tubeOpts } = opts;
  let canvas: HTMLCanvasElement;
  if (target instanceof HTMLCanvasElement) {
    canvas = target;
  } else {
    canvas = document.createElement('canvas');
    canvas.className = `crt__tube${canvasClass ? ` ${canvasClass}` : ''}`;
    canvas.setAttribute('aria-hidden', 'true');
    target.appendChild(canvas);
  }

  // 首页的状态位在洞上（CSS 用它关 CSS 玻璃层）；彩蛋显式传 null：
  // root 的 is-tube 属于播放编排，且洞上不能加 —— 那会把彩蛋的 CSS 玻璃层一起关掉。
  const stateHost = customHost === undefined
    ? canvas.closest<HTMLElement>('.crt__aperture')
    : customHost;
  let handle: TubeHandle | null = null;

  const detach = (): void => {
    handle?.dispose();
    handle = null;
    canvas.classList.remove('is-live');
    stateHost?.classList.remove('is-tube', 'is-fallback');
  };

  return {
    canvas,
    attach(source) {
      if (handle) detach(); // 重复挂载会泄漏 WebGL 上下文，先还掉旧的
      const frame = isFrameFn(source) ? source : () => ({ a: source, b: null, mix: 0 });
      handle = mountTube(canvas, frame, tubeOpts);
      if (!handle) {
        stateHost?.classList.add('is-fallback');
        return false;
      }
      canvas.classList.add('is-live');
      stateHost?.classList.add('is-tube');
      return true;
    },
    setActive(on) {
      handle?.setActive(on);
    },
    detach,
  };
}
