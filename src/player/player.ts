/**
 * 老电视播放器编排（原项目彩蛋的播放逻辑精简版）。
 *
 * 保留：开机信号（雪花 / 彩条 / 开机亮线）、WebGL 管面接画面、片源单（右侧列表）、
 *       换台(∧∨) / 音量(+-) 软键、屏显 OSD、等待 / 缓冲 / 断流都回退到「无信号」画面。
 * 删除：Konami / 连点触发、首段回忆短片、BGM、把首页电视拎出来通电的全屏覆盖层与退出。
 *
 * 这台电视就是页面本身：默认首屏待机，按电源键通电（这一次点击同时给了
 * 浏览器有声自动播放所需的用户手势，也给了 CRT 亮线展开动画一个真实起点），
 * 然后开机序列 → 拨到第一个台；电源键再按一次回到待机，片单不动。
 */
import { stageGeom, tvTransform, applyTvTransform, isNarrow, stationReserves } from './layout';
import { createTubeView, type TubeFrame, type TubeView } from './view';
import { CRT_KEYS_HTML } from './CrtTv';
import type { Channel } from './sequence';
import { BARS_SVG, NOTE, startSnow, fmtDuration, esc } from './signal';
import { isRemote, createMediaTools } from './media';
import { stepVolume, nextChannelIndex, osdText, dialMinutes } from './controller';

const MUTED = false;

/** 每次挂载自增；退场时比对，避免快速反复开关时旧播放器的延迟卸载误改共享的 .crt 状态。 */
let liveGen = 0;

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    let timer = 0;
    const finish = () => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      resolve();
    };
    timer = window.setTimeout(finish, 120);
    requestAnimationFrame(finish);
  });
}

const clampVol = (v: number): number => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0.9));

export interface PlayerOptions {
  /** 整机元素 .crt（含 .crt__screen / .crt__aperture / .crt__chin）。 */
  tv: HTMLElement;
  /** 舞台根 .crtv：片单与 is-stations / is-watching / is-dial-hidden 状态位都挂这里。 */
  root: HTMLElement;
  /** 片源单。 */
  channels: Channel[];
  /** 初始音量 0–1，默认 0.9。 */
  initialVolume?: number;
  /** 默认 false：首屏待机，按电源键才通电（有声播放需要用户手势）。
   *  页面里已有手势时设 true 可打开即播，仍保留被拦后的静音兜底。 */
  autoBoot?: boolean;
}

export interface PlayerHandle {
  /** 卸载播放器（页面销毁 / 片源变化时）。开关机不走这里。 */
  cleanup(): void;
  /** 电源键：待机只暂停画面与声音，片单不受影响；再按恢复并重放通电动画。 */
  setPower(on: boolean): void;
  /** 追加本机视频文件为临时频道（blob: URL，仅本次会话有效）。 */
  addLocalFiles(files: FileList | File[]): Channel[];
}

export function mountPlayer(opts: PlayerOptions): PlayerHandle {
  const { tv, root } = opts;
  /** 局部副本：追加本地频道时不污染调用方传入的数组。 */
  const list: Channel[] = [...opts.channels];
  const autoBoot = opts.autoBoot ?? false;
  const myGen = ++liveGen;
  tv.dataset.playerGen = String(myGen);
  const aperture = tv.querySelector<HTMLElement>('.crt__aperture');
  const screen = tv.querySelector<HTMLElement>('.crt__screen');
  const chin = tv.querySelector<HTMLElement>('.crt__chin');
  const stageEl = tv.parentElement;
  if (!aperture || !screen || !stageEl) {
    return { cleanup: () => {}, setPower: () => {}, addLocalFiles: () => [] };
  }
  const stage: HTMLElement = stageEl;

  let videoVolume = clampVol(opts.initialVolume ?? 0.9);
  /** 有声自动播放被浏览器拦下（无用户手势）。显式通电后电源键就是手势，
   *  这条通常走不到；autoBoot / 嵌入页仍可能命中，兜底保留。 */
  let soundBlocked = false;
  let gestureBound = false;

  // 开机闸门：默认等电源键点击才放行，点击即用户手势，后续 play() 全部允许有声。
  let poweredOn = autoBoot;
  let gateOpen = autoBoot;
  let powerResolve: (() => void) | null = null;
  const powerGate: Promise<void> = autoBoot
    ? Promise.resolve()
    : new Promise<void>((res) => {
        powerResolve = res;
      });
  function openGate(): void {
    if (gateOpen) return;
    gateOpen = true;
    powerResolve?.();
  }

  /** 本机视频生成的 blob: URL，卸载时统一回收。 */
  const localUrls: string[] = [];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const controller = new AbortController();
  const signal = controller.signal;
  const { wait, whenReady, waitEnd } = createMediaTools(signal);

  // ---- DOM ----
  const SIGNAL_HTML = `
    <canvas class="tv__snow" aria-hidden="true"></canvas>
    <div class="tv__bars" aria-hidden="true">${BARS_SVG}</div>
    <div class="tv__scan" aria-hidden="true"></div>
    <div class="tv__tear" aria-hidden="true"></div>
    <p class="tv__note" role="status" aria-live="polite"></p>
  `;
  const FILM_HTML = `
    <video class="tv__video" playsinline preload="auto" disablepictureinpicture disableremoteplayback controlslist="nodownload noremoteplayback noplaybackrate" draggable="false"></video>
    <video class="tv__video" playsinline preload="auto" disablepictureinpicture disableremoteplayback controlslist="nodownload noremoteplayback noplaybackrate" draggable="false"></video>
  `;

  const signalLayer = document.createElement('div');
  signalLayer.className = 'tv__signal';
  signalLayer.innerHTML = SIGNAL_HTML;
  const film = document.createElement('div');
  film.className = 'tv__film';
  film.setAttribute('aria-hidden', 'true');
  film.innerHTML = FILM_HTML;
  const osd = document.createElement('div');
  osd.className = 'tv__osd';
  osd.setAttribute('aria-hidden', 'true');
  osd.innerHTML = `<span class="tv__osd-text"></span><span class="tv__osd-meter">${'<i></i>'.repeat(10)}</span>`;
  const osdSr = document.createElement('span');
  osdSr.className = 'tv__osd-sr';
  osdSr.setAttribute('role', 'status');
  osdSr.setAttribute('aria-live', 'polite');
  const tubeCanvas = document.createElement('canvas');
  tubeCanvas.className = 'crt__tube';
  tubeCanvas.setAttribute('aria-hidden', 'true');

  // 亮线是开机序列的「第一帧」：必须是 .crt__screen 的直接子元素，
  // 不能放进 .tv__signal —— 待机时信号层被 .crt.is-off 坍缩成线 + 320ms 淡入，
  // 会把亮线展开的关键帧整段盖住，体感就是「直接播放、看不到线」。
  // 独立出来挂在信号层之上（玻璃层之下），只受 is-power 控制。
  const powerLine = document.createElement('div');
  powerLine.className = 'tv__powerline';
  powerLine.setAttribute('aria-hidden', 'true');

  screen.replaceChildren(signalLayer, film, tubeCanvas, osd, powerLine);
  signalLayer.appendChild(osdSr);

  const noteEl = signalLayer.querySelector<HTMLElement>('.tv__note')!;
  const snowCanvas = signalLayer.querySelector<HTMLCanvasElement>('.tv__snow')!;
  const vA = film.querySelectorAll<HTMLVideoElement>('.tv__video')[0];
  const vB = film.querySelectorAll<HTMLVideoElement>('.tv__video')[1];
  const osdEl = osd;
  const osdMeter = osd.querySelector<HTMLElement>('.tv__osd-meter');
  let osdTimer = 0;

  // 下巴四颗软键（换台 / 音量），与电源键同源
  let keysEl: HTMLElement | null = null;
  if (list.length) {
    chin?.insertAdjacentHTML('beforeend', CRT_KEYS_HTML);
    keysEl = tv.querySelector<HTMLElement>('.crt__keys');
  }

  // ---- 管面 ----
  const mixNow = (): number => {
    if (mixDur <= 0) return mixTo;
    const t = Math.min(1, (performance.now() - mixStart) / mixDur);
    return mixFrom + (mixTo - mixFrom) * t;
  };
  let mixFrom = 0;
  let mixTo = 0;
  let mixStart = 0;
  let mixDur = 0;
  const startMix = (to: number, ms: number): void => {
    mixFrom = mixNow();
    mixTo = to;
    mixStart = performance.now();
    mixDur = Math.max(0, ms);
  };
  const frameTube = (): TubeFrame => {
    const m = mixNow();
    const tag = m.toFixed(2);
    if (tubeCanvas.dataset.mix !== tag) tubeCanvas.dataset.mix = tag;
    return { a: vA, b: vB, mix: m };
  };
  const tubeView: TubeView | null = createTubeView(tubeCanvas, {
    fit: 'contain',
    reduceMotion: reduce,
    stateHost: aperture,
  });
  tubeView.attach(frameTube);

  // ---- 雪花 ----
  let snowStop: (() => void) | null = null;
  let snowTimer = 0;
  const killSnow = (): void => {
    window.clearTimeout(snowTimer);
    snowStop?.();
    snowStop = null;
  };
  const ensureSnow = (): void => {
    window.clearTimeout(snowTimer);
    if (snowStop) return;
    snowStop = startSnow(snowCanvas, reduce, signal, screen);
  };
  const stopSnowAfterFade = (): void => {
    window.clearTimeout(snowTimer);
    snowTimer = window.setTimeout(() => {
      if (!tv.classList.contains('is-hold')) killSnow();
    }, 560);
  };

  // ---- 片源单 / 播放状态 ----
  let front = vA;
  const failed = new Set<number>();
  let curIdx = -1;
  let dialEl: HTMLElement | null = null;
  let tabEl: HTMLButtonElement | null = null;
  let chanAbort: AbortController | null = null;
  let want: number | null = null;
  let wake: (() => void) | null = null;
  /** 换台请求提前挂好：片单在待机时已可见，但播放循环要等通电才启动。 */
  const ask = (i: number): void => {
    if (!Number.isInteger(i) || i < 0 || i >= list.length) return;
    want = i;
    failed.delete(i);
    chanAbort?.abort();
    wake?.();
  };
  const requestChannel: ((i: number) => void) | null = ask;

  // ---- 电视布局：复刻 arley-fun 的 layoutTv / layoutStations ----
  // 整台电视是 fixed 的独立合成层，只改 transform；在「视口 − 片单」的可用区里居中，
  // 片单永不压住屏幕。收起片单后电视回到整个视口正中。
  const geom = stageGeom(stage);
  function layoutTv(reserveRight: number, reserveBottom: number, animate: boolean): void {
    applyTvTransform(
      stage,
      tvTransform(geom, window.innerWidth, window.innerHeight, reserveRight, reserveBottom),
      animate,
      reduce,
    );
  }

  /** 桌面临时把右侧让给片单，手机把底部让给抽屉；收起片单后电视回到正中。 */
  function layoutStations(animate = true): void {
    const narrow = isNarrow();
    const hidden = dialEl?.classList.contains('is-collapsed') ?? true;
    if (narrow) layoutTv(0, hidden || !dialEl ? 0 : dialEl.offsetHeight + 10, animate);
    else layoutTv(hidden || !dialEl ? 0 : dialEl.offsetWidth + 22, 0, animate);
  }

  // 直接复用 mountPlayer() 的调用方没走过 main.tsx 的首帧布局：这里同步校正一次
  // （同值、无动画）。待机首屏没有片单，按全视口居中；autoBoot 才按片单让位。
  const initial = gateOpen ? stationReserves(root) : { right: 0, bottom: 0 };
  layoutTv(initial.right, initial.bottom, false);

  function setDialHidden(hide: boolean): void {
    if (!dialEl) return;
    dialEl.classList.toggle('is-collapsed', hide);
    // 滑到画外只是视觉上的：不加 inert，Tab 还能走进那些看不见的按钮。
    dialEl.inert = hide;
    dialEl.toggleAttribute('inert', hide);
    if (hide) dialEl.setAttribute('aria-hidden', 'true');
    else dialEl.removeAttribute('aria-hidden');
    root.classList.toggle('is-dial-hidden', hide);
    layoutStations(true);
    // 收起时标签才是能点的那个；展开时它整颗不可见，必须退出 tab 序列。
    if (tabEl) tabEl.tabIndex = hide ? 0 : -1;
    if (hide) tabEl?.focus({ preventScroll: true });
    else dialEl.querySelector<HTMLElement>('.tv__chan')?.focus({ preventScroll: true });
  }

  window.addEventListener('resize', () => layoutStations(false), { passive: true, signal });

  // ---- 工具 ----
  function showHold(text: string): void {
    noteEl.textContent = text;
    tv.classList.add('is-hold', 'is-bars');
    tv.classList.remove('is-film');
    // 等信号的时候片单回到正常亮度：这几秒用户要看的就是那张表
    root.classList.remove('is-watching');
    ensureSnow();
  }
  function endHold(): void {
    tv.classList.remove('is-hold', 'is-bars');
    stopSnowAfterFade();
  }

  function setSource(v: HTMLVideoElement, src: string): void {
    v.pause();
    v.classList.remove('is-front');
    if (v.readyState > 0) v.currentTime = 0;
    v.muted = MUTED || soundBlocked || videoVolume === 0;
    v.volume = videoVolume;
    if (isRemote(src)) v.crossOrigin = 'anonymous';
    else v.removeAttribute('crossorigin');
    v.src = src;
  }
  function clearSource(el: HTMLMediaElement): void {
    el.pause();
    el.removeAttribute('src');
    el.load();
  }
  /** 音量与静音态只在这一处落地：换片、解锁、音量键都走它。 */
  function applyVolumeTo(el: HTMLVideoElement): void {
    el.volume = videoVolume;
    el.muted = MUTED || soundBlocked || videoVolume === 0;
  }

  /** 待机提示走 OSD：OSD 是屏幕的直接子元素，不受 .crt.is-off 的画面坍缩影响。 */
  function showPowerHint(): void {
    window.clearTimeout(osdTimer);
    osdEl.dataset.mode = 'power';
    const text = osdEl.querySelector<HTMLElement>('.tv__osd-text');
    if (text) text.textContent = NOTE.power;
    osdSr.textContent = '电视处于待机，按电源键通电';
    osdEl.classList.add('is-on');
  }
  function hidePowerHint(): void {
    if (osdEl.dataset.mode !== 'power') return;
    delete osdEl.dataset.mode;
    osdEl.classList.remove('is-on');
  }

  /** 重新触发亮线动画：先摘 is-power 并强制样式计算，再挂回去，animation 才会从头播。 */
  function replayPowerLine(): void {
    if (!powerLine || reduce) return;
    tv.classList.remove('is-power');
    void powerLine.offsetWidth;
    tv.classList.add('is-power');
  }

  function hideSoundHint(): void {
    if (osdEl.dataset.mode !== 'sound') return;
    delete osdEl.dataset.mode;
    osdEl.classList.remove('is-on');
  }
  function showSoundHint(): void {
    window.clearTimeout(osdTimer);
    osdEl.dataset.mode = 'sound';
    const text = osdEl.querySelector<HTMLElement>('.tv__osd-text');
    if (text) text.textContent = NOTE.sound;
    osdSr.textContent = '浏览器拦下了自动播放的声音，轻点屏幕即可开启';
    osdEl.classList.add('is-on');
  }

  /** 用户给过手势后浏览器就允许有声播放：立刻把「当前这一遍」救回来，
   *  不必等下一次 setSource 重发 play —— 那正是「循环两三遍才有声」的由来。 */
  function unlockSound(): void {
    if (!soundBlocked) return;
    soundBlocked = false;
    for (const el of [vA, vB]) applyVolumeTo(el);
    hideSoundHint();
    void front.play().catch(() => {});
  }

  function bindGestureUnlock(): void {
    if (gestureBound) return;
    gestureBound = true;
    const events = ['pointerdown', 'touchend', 'keydown'] as const;
    const onGesture = (): void => {
      for (const type of events) document.removeEventListener(type, onGesture, true);
      unlockSound();
    };
    for (const type of events) {
      document.addEventListener(type, onGesture, { capture: true, passive: true, signal });
    }
  }

  /** 带声音的 play() 被拦时降级为静音，画面必须继续（同 arley-fun）。 */
  async function safePlay(v: HTMLVideoElement): Promise<boolean> {
    if (!MUTED && !soundBlocked) {
      try {
        await v.play();
        return true;
      } catch (err) {
        if (!(err instanceof DOMException) || err.name !== 'NotAllowedError') return false;
        soundBlocked = true;
        for (const el of [vA, vB]) applyVolumeTo(el);
        showSoundHint();
        bindGestureUnlock();
      }
    }
    v.muted = true;
    try {
      await v.play();
      return true;
    } catch {
      return false;
    }
  }

  function showOsd(mode: 'ch' | 'vol', value: number): void {
    if (!osdEl) return;
    osdEl.dataset.mode = mode;
    const text = osdEl.querySelector<HTMLElement>('.tv__osd-text');
    const { display, sr, lit } = osdText(mode, value);
    if (text) text.textContent = display;
    if (mode === 'vol') {
      osdMeter?.querySelectorAll('i').forEach((bar, i) => bar.classList.toggle('is-lit', i < lit));
    }
    osdSr.textContent = sr;
    osdEl.classList.add('is-on');
    window.clearTimeout(osdTimer);
    osdTimer = window.setTimeout(() => osdEl?.classList.remove('is-on'), 1400);
  }
  function volumeBy(dir: 1 | -1): void {
    const v = stepVolume(videoVolume, dir);
    videoVolume = v;
    // 同 arley-fun：音量键本身就是手势，按一下即可解除自动播放的静音兜底
    if (v > 0 && soundBlocked) unlockSound();
    for (const el of [vA, vB]) applyVolumeTo(el);
    showOsd('vol', v);
  }
  function tuneBy(dir: 1 | -1): void {
    if (!list.length) return;
    const next = nextChannelIndex(curIdx, dir, list.length);
    showOsd('ch', next + 1);
    requestChannel?.(next);
  }

  // 下巴软键（事件委托）
  chin?.addEventListener(
    'click',
    (e) => {
      if (!gateOpen) return;
      const btn = (e.target as HTMLElement).closest<HTMLElement>('.knob--soft');
      if (!btn) return;
      const k = btn.dataset.knob;
      if (k === 'ch-up') tuneBy(-1);
      else if (k === 'ch-down') tuneBy(1);
      else if (k === 'vol-up') volumeBy(1);
      else if (k === 'vol-down') volumeBy(-1);
    },
    { signal },
  );

  // 键盘遥控（方向键换台、+/- 调音量；输入框里不拦截）
  function onKey(e: KeyboardEvent): void {
    if (!gateOpen) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      tuneBy(-1);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      tuneBy(1);
    } else if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      volumeBy(1);
    } else if (e.key === '-' || e.key === '_') {
      e.preventDefault();
      volumeBy(-1);
    }
  }
  window.addEventListener('keydown', onKey, { signal });

  function setCurrent(i: number): void {
    dialEl?.querySelectorAll<HTMLElement>('.tv__chan').forEach((btn, n) => {
      const on = n === i;
      btn.classList.toggle('is-playing', on);
      if (on) btn.setAttribute('aria-current', 'true');
      else btn.removeAttribute('aria-current');
    });
  }
  function markLost(i: number): void {
    dialEl?.querySelector(`.tv__chan[data-i="${i}"]`)?.classList.add('is-lost');
  }
  function clearLost(i: number): void {
    dialEl?.querySelector(`.tv__chan[data-i="${i}"]`)?.classList.remove('is-lost');
  }

  function chanItemHtml(c: Channel, i: number): string {
    return `<li class="tv__chan-item">
      <button class="tv__chan" type="button" data-i="${i}">
        <span class="tv__chan-no">${String(i + 1).padStart(2, '0')}</span>
        <span class="tv__chan-body">
          <span class="tv__chan-title">${esc(c.title)}</span>
          <span class="tv__chan-sub"><span class="tv__chan-meta">${esc(
            [c.year, c.studio, fmtDuration(c.duration)].filter(Boolean).map(String).join(' · '),
          )}</span></span>
        </span>
        <span class="tv__chan-mark" aria-hidden="true"></span>
      </button>
    </li>`;
  }

  function dialMeta(): string {
    const minutes = dialMinutes(list);
    return `${list.length} 部${minutes !== null ? ` · 约 ${minutes} 分钟` : ''}`;
  }

  function buildDial(): HTMLElement {
    const dial = document.createElement('aside');
    dial.className = 'tv__dial';
    dial.setAttribute('aria-label', '片源单');
    dial.innerHTML = `
      <div class="tv__dial-head">
        <p class="tv__dial-kicker">片源单</p>
        <h2 class="tv__dial-title">今日片单</h2>
        <p class="tv__dial-meta">${dialMeta()}</p>
        <button class="tv__dial-hide" type="button" aria-label="收起片单，只看电视">收起</button>
      </div>
      <ol class="tv__dial-list">
        ${list.map((c, i) => chanItemHtml(c, i)).join('')}
      </ol>
      <div class="tv__dial-foot">
        <label class="tv__dial-add">＋ 本地视频
          <input type="file" accept="video/*" multiple aria-label="选择本机视频文件" />
        </label>
        <span>本地 / 直链 / 对象存储 · 仅供怀旧观摩</span>
      </div>
    `;
    return dial;
  }

  /** 追加本机视频：blob: 与页面同源，WebGL 管面可直接取帧，不需要 crossOrigin。
   *  只追加 DOM 行，不重建片单，避免打断当前播放、收起状态与焦点。 */
  function addLocalFiles(files: FileList | File[]): Channel[] {
    const added: Channel[] = [];
    const start = list.length;
    for (const f of Array.from(files)) {
      if (!f) continue;
      const looksVideo = (f.type || '').startsWith('video/') || /\.(mp4|webm|ogv|mov|m4v)$/i.test(f.name);
      if (!looksVideo) continue;
      const url = URL.createObjectURL(f);
      localUrls.push(url);
      list.push({ src: url, title: f.name.replace(/\.[^.]+$/, '') || `本地视频 ${list.length + 1}` });
      added.push(list[list.length - 1]);
    }
    if (!added.length || !dialEl) return added;
    dialEl
      .querySelector<HTMLElement>('.tv__dial-list')
      ?.insertAdjacentHTML('beforeend', added.map((c, n) => chanItemHtml(c, start + n)).join(''));
    const meta = dialEl.querySelector<HTMLElement>('.tv__dial-meta');
    if (meta) meta.textContent = dialMeta();
    if (tabEl) tabEl.innerHTML = `片单<span>${list.length}</span>`;
    layoutStations(false);
    return added;
  }

  /** 播一部；返回 ended 自动接下一部，error 上层决定跳下一部还是歇着。 */
  async function playChannel(i: number): Promise<'ended' | 'error' | 'stopped' | 'switched'> {
    const item = list[i];
    const ctl = new AbortController();
    chanAbort = ctl;
    const stopped = (): boolean => signal.aborted || ctl.signal.aborted;
    const result = (why: 'ended' | 'error'): 'ended' | 'error' | 'stopped' | 'switched' =>
      signal.aborted ? 'stopped' : ctl.signal.aborted ? 'switched' : why;

    showHold(NOTE.wait);
    tv.style.setProperty('--tv-xfade', '200ms');
    front.classList.remove('is-front');
    await wait(180, ctl.signal);
    if (stopped()) return result('error');

    const el = front === vA ? vB : vA;
    setSource(el, item.src);
    let ready = false;
    const slow = window.setTimeout(() => {
      if (!ready && !stopped()) showHold(NOTE.slow);
    }, 5200);
    let ok = await whenReady(el, 18000, ctl.signal);
    if (!ok && !stopped() && isRemote(item.src) && !item.src.includes('c=1')) {
      setSource(el, `${item.src}${item.src.includes('?') ? '&' : '?'}c=1`);
      ok = await whenReady(el, 18000, ctl.signal);
    }
    ready = true;
    window.clearTimeout(slow);
    if (stopped()) {
      el.pause();
      clearSource(el);
      return result('error');
    }
    if (!ok) {
      clearSource(el);
      failed.add(i);
      markLost(i);
      showHold(NOTE.lost);
      await wait(1800, ctl.signal);
      return result('error');
    }

    const played = await safePlay(el);
    if (stopped()) {
      el.pause();
      return result('error');
    }
    if (!played) {
      clearSource(el);
      failed.add(i);
      markLost(i);
      showHold(NOTE.cut);
      await wait(1600, ctl.signal);
      return result('error');
    }

    tv.style.setProperty('--tv-xfade', '260ms');
    endHold();
    tv.classList.add('is-film');
    el.classList.add('is-front');
    startMix(el === vB ? 1 : 0, 260);
    front = el;
    setCurrent(i);
    clearLost(i);
    failed.delete(i);
    curIdx = i;
    // 片子真的放起来了：片单退到背景里，电视重新成为主角
    root.classList.add('is-watching');

    const why = await waitEnd(el, ctl.signal);
    if (why !== 'ended') el.pause();
    if (why === 'stopped') return 'stopped';
    if (why === 'error') {
      failed.add(i);
      markLost(i);
      showHold(NOTE.cut);
      await wait(1600, ctl.signal);
      return result('error');
    }
    return 'ended';
  }

  /** 通电后才建片单：is-stations 一加，CSS 的 300ms 淡入才有起点，
   *  同时电视从「全视口正中」带 520ms 动画让到片单旁边。待机时屏幕上没有片单。 */
  function setupStations(): void {
    if (!list.length || dialEl) return;
    dialEl = buildDial();
    root.appendChild(dialEl);
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'tv__dial-tab';
    tab.innerHTML = `片单<span>${list.length}</span>`;
    tab.setAttribute('aria-label', '展开片单');
    tab.tabIndex = -1;
    root.appendChild(tab);
    tabEl = tab;
    tab.addEventListener('click', () => setDialHidden(false), { signal });

    dialEl.addEventListener(
      'click',
      (e) => {
        const t = e.target as HTMLElement;
        const btn = t.closest<HTMLElement>('.tv__chan');
        if (btn) ask(Number(btn.dataset.i));
        else if (t.closest('.tv__dial-hide')) setDialHidden(true);
      },
      { signal },
    );
    dialEl.addEventListener(
      'change',
      (e) => {
        const input = (e.target as HTMLElement).closest<HTMLInputElement>('input[type="file"]');
        if (!input?.files?.length) return;
        const added = addLocalFiles(input.files);
        input.value = '';
        if (added.length) ask(list.length - added.length);
      },
      { signal },
    );

    root.classList.add('is-stations');
    layoutStations(true);
  }

  async function runStations(): Promise<void> {
    await powerGate;
    if (signal.aborted) return;
    showHold(NOTE.idle);
    front = vA;

    let idx = 0;
    let autoNext = true;
    for (;;) {
      while (!signal.aborted) {
        if (want === null && !autoNext) {
          await new Promise<void>((res) => {
            const onAbort = () => res();
            signal.addEventListener('abort', onAbort, { once: true });
            wake = () => {
              signal.removeEventListener('abort', onAbort);
              res();
            };
          });
          if (signal.aborted) break;
        }
        wake = null;
        const i = want ?? idx;
        want = null;
        autoNext = false;
        idx = i;

        const res = await playChannel(i);
        if (signal.aborted) break;
        if (res === 'switched') continue;
        if (res === 'ended') {
          idx = (i + 1) % list.length;
          autoNext = true;
          continue;
        }
        if (failed.size >= list.length) break;
        idx = (i + 1) % list.length;
        autoNext = true;
      }
      if (signal.aborted) break;
      showHold('全部频道暂时都接收不到，过会儿再试');
      await wait(3000, signal);
    }
  }

  async function boot(): Promise<void> {
    await powerGate;
    if (signal.aborted) return;
    hidePowerHint();
    tv.classList.remove('is-off');
    tv.classList.add('is-on');
    ensureSnow();
    replayPowerLine();
    await wait(reduce ? 0 : 420);
    tv.classList.add('is-bars');
    await wait(reduce ? 0 : 300);
    tv.classList.remove('is-power');
    if (signal.aborted) return;
    setupStations();
    if (list.length === 0) {
      noteEl.textContent = '暂无片源';
      return;
    }
    await runStations();
  }

  if (autoBoot) {
    tv.classList.remove('is-off');
    tv.classList.add('is-on');
  } else {
    showPowerHint();
  }
  void nextFrame().then(boot);

  // 电源键 = 待机：只停画面与声音，片单、片单状态、布局一律不动。
  // 画面坍缩由 .crt.is-off 的 CSS 负责；因为不再清屏，亮线动画始终有元素可动。
  function setPower(on: boolean): void {
    if (poweredOn === on) return;
    poweredOn = on;
    tv.classList.toggle('is-off', !on);
    const powerBtn = chin?.querySelector<HTMLButtonElement>('.knob--power');
    if (powerBtn) {
      powerBtn.setAttribute('aria-pressed', String(on));
      powerBtn.setAttribute('aria-label', on ? '关闭小电视' : '打开小电视');
    }
    if (!on) {
      for (const v of [vA, vB]) v.pause();
      killSnow();
      tv.classList.remove('is-power');
      return;
    }
    const wasBooted = gateOpen;
    openGate(); // 首次按下这次点击就是有声自动播放所需的用户手势
    if (!wasBooted) return; // boot() 负责亮线展开 → 开机序列 → 片单淡入
    replayPowerLine(); // 之后的待机→通电：重放亮线，直接续播，片单不动
    window.setTimeout(() => tv.classList.remove('is-power'), 640);
    if (tv.classList.contains('is-film')) void safePlay(front);
    else ensureSnow();
  }
  chin?.querySelector('.knob--power')?.addEventListener('click', () => setPower(!poweredOn), { signal });

  function cleanup(): void {
    controller.abort();
    openGate(); // 放掉待机时挂在 powerGate 上的 boot，别留悬挂 Promise
    killSnow();
    window.clearTimeout(osdTimer);
    for (const url of localUrls) URL.revokeObjectURL(url);
    localUrls.length = 0;
    tubeView?.detach();
    for (const v of [vA, vB]) clearSource(v);
    keysEl?.remove();
    signalLayer.remove();
    film.remove();
    tubeCanvas.remove();
    osd.remove();
    powerLine.remove();
    dialEl?.remove();
    tabEl?.remove();
    stage.style.transform = '';
    stage.style.transition = '';
    root.classList.remove('is-stations', 'is-watching', 'is-dial-hidden');
    tv.classList.remove('is-on', 'is-film', 'is-hold', 'is-bars', 'is-power', 'is-signal');
    tv.classList.toggle('is-off', !autoBoot);
  }

  return { cleanup, setPower, addLocalFiles };
}
