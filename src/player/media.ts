/**
 * 媒体运行时工具：等待 / 可播判定 / 音量淡变都只依赖退出信号与传入的元素。
 * createMediaTools(signal) 把这份 signal 固化下来，调用点无需重复传，
 * 也让播放编排状态机不必外泄成 context 对象。
 */
/** 远端片源才需要 CORS；站内 /media/* 不加，别去动已经跑通的那条路。
 *  协议相对地址（//host/x.mp4）也算远端：它同样是跨域，漏判会让纹素被标脏、
 *  管面每帧 texImage2D 抛 SecurityError（渲染循环直接断）。 */
export const isRemote = (src: string): boolean => /^(https?:)?\/\//i.test(src);

export function createMediaTools(signal: AbortSignal) {
  const fadeTokens = new WeakMap<HTMLMediaElement, number>();

  function fadeVolume(el: HTMLMediaElement, from: number, to: number, ms: number): void {
    const token = (fadeTokens.get(el) ?? 0) + 1;
    fadeTokens.set(el, token);
    if (ms <= 0) {
      el.volume = to;
      return;
    }
    const t0 = performance.now();
    const step = () => {
      if (fadeTokens.get(el) !== token) return; // 新的淡入淡出接管，旧的立刻停手
      const p = Math.min(1, (performance.now() - t0) / ms);
      el.volume = Math.max(0, Math.min(1, from + (to - from) * p));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /** 受 abort 影响的等待。ctl 是「这一部片子」的控制器：失败态里按换台不该
   *  还要把 1.6–1.8s 的提示等满，连按几下就会读成「键不跟手」。 */
  function wait(ms: number, ctl?: AbortSignal | null): Promise<void> {
    return new Promise((resolve) => {
      if (signal.aborted || ctl?.aborted) return resolve();
      let timer = 0;
      const done = () => {
        signal.removeEventListener('abort', onAbort);
        ctl?.removeEventListener('abort', onAbort);
        resolve();
      };
      const onAbort = () => {
        window.clearTimeout(timer);
        done();
      };
      timer = window.setTimeout(done, ms);
      signal.addEventListener('abort', onAbort, { once: true });
      ctl?.addEventListener('abort', onAbort, { once: true });
    });
  }

  /** 等元素可播。ctl 是「这一次换台」的控制器：换台键连点时，上一部不该把新的
   *  请求一起拖住 —— 慢源最长会把 wait 挂满 channelTimeoutMs（18s），
   *  那期间连按五下看着就是「键坏了」。 */
  function whenReady(v: HTMLVideoElement, timeoutMs: number, ctl?: AbortSignal | null): Promise<boolean> {
    // 进入时**已经** abort 的 signal 再挂 listener 永远不会触发（EventTarget 不补发历史事件）。
    // 开机那一秒多里按换台，cutIntro 此刻就 abort 了；没有这道守卫，慢首段会只有
    // 超时这一条出路 —— 线上 20s 雪花，用户读到的是「键坏了」。快路径同理。
    if (signal.aborted || ctl?.aborted) return Promise.resolve(false);
    if (v.readyState >= 3) return Promise.resolve(true);
    return new Promise((resolve) => {
      let done = false;
      let timer = 0;
      const onAbort = () => finish(false); // Esc 时立刻收束，别让搜台等待把退出卡住 20 秒
      const finish = (ok: boolean) => {
        if (done) return;
        done = true;
        window.clearTimeout(timer);
        v.removeEventListener('canplay', onReady);
        v.removeEventListener('loadeddata', onReady);
        v.removeEventListener('error', onError);
        signal.removeEventListener('abort', onAbort);
        ctl?.removeEventListener('abort', onAbort);
        resolve(ok);
      };
      const onReady = () => finish(true);
      const onError = () => finish(false);
      v.addEventListener('canplay', onReady, { once: true });
      v.addEventListener('loadeddata', onReady, { once: true });
      v.addEventListener('error', onError, { once: true });
      signal.addEventListener('abort', onAbort, { once: true });
      ctl?.addEventListener('abort', onAbort, { once: true });
      timer = window.setTimeout(() => finish(v.readyState >= 3), timeoutMs);
    });
  }

  /** rAF 盯 currentTime 比 setTimeout 更贴合真实播放进度；另有墙钟兜底防后台标签页停摆。
   *  cut：换台键的掐断信号。它与退出信号分开 —— 退回首页是一条路，
   *  「这段不看了，换台」是另一条，不能都塞进同一个 abort。 */
  function waitForTime(v: HTMLVideoElement, target: number, cut?: AbortSignal | null): Promise<void> {
    // 已经被掐断过就立刻返回：addEventListener 挂在一个已经 abort 的 signal 上
    // 永远不会触发，硬等下去就是干等（最长到墙钟兜底那一秒）
    if (signal.aborted || cut?.aborted) return Promise.resolve();
    return new Promise((resolve) => {
      let done = false;
      let raf = 0;
      let timer = 0;
      const finish = () => {
        if (done) return;
        done = true;
        cancelAnimationFrame(raf);
        window.clearTimeout(timer);
        v.removeEventListener('ended', finish);
        signal.removeEventListener('abort', finish);
        cut?.removeEventListener('abort', finish);
        resolve();
      };
      v.addEventListener('ended', finish, { once: true });
      signal.addEventListener('abort', finish, { once: true });
      cut?.addEventListener('abort', finish, { once: true });
      const tick = () => {
        if (done) return;
        if (v.ended || v.currentTime >= target) return finish();
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      timer = window.setTimeout(finish, Math.max(0, target - v.currentTime) * 1000 + 600);
    });
  }

  /** 等一部片子自己放完。外链片源不能靠 waitForTime 里那个「按已知时长算」的墙钟：
   *  远端元数据才准，中途断流又不会触发 ended。这里听 ended / error，
   *  再用看门狗盯 currentTime 是否还在走 —— 卡住 25 秒当断流处理，不干等。 */
  function waitEnd(
    v: HTMLVideoElement,
    ctl: AbortSignal,
  ): Promise<'ended' | 'error' | 'stopped'> {
    // 与 waitForTime / whenReady 对齐：进入时已 abort 就直接收束，
    // 别把 listener 挂在一个不会有事件的 signal 上白等一整部片子。
    if (signal.aborted || ctl.aborted) return Promise.resolve('stopped');
    return new Promise((resolve) => {
      let done = false;
      let lastT = -1;
      let lastMove = performance.now();
      let raf = 0;
      const finish = (why: 'ended' | 'error' | 'stopped') => {
        if (done) return;
        done = true;
        cancelAnimationFrame(raf);
        v.removeEventListener('ended', onEnded);
        v.removeEventListener('error', onError);
        signal.removeEventListener('abort', onAbort);
        ctl.removeEventListener('abort', onAbort);
        document.removeEventListener('visibilitychange', onVisibility);
        resolve(why);
      };
      const onEnded = () => finish('ended');
      const onError = () => finish('error');
      const onAbort = () => finish('stopped');
      // 切走标签页时 rAF 冻结、墙钟照走；回来第一帧若视频还没恢复推进，
      // 25s 的累计差值会被误读成断流。可见性一变就把基准拨回现在 ——
      // 真断流仍有 25s 可判定，只是不把「离开页面那段」算进去。
      const onVisibility = () => { lastMove = performance.now(); };
      v.addEventListener('ended', onEnded, { once: true });
      v.addEventListener('error', onError, { once: true });
      signal.addEventListener('abort', onAbort, { once: true });
      ctl.addEventListener('abort', onAbort, { once: true });
      document.addEventListener('visibilitychange', onVisibility);
      const tick = () => {
        if (done) return;
        const t = v.currentTime;
        if (t !== lastT) {
          lastT = t;
          lastMove = performance.now();
        } else if (performance.now() - lastMove > 25000) {
          return finish('error');
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    });
  }

  return { fadeVolume, wait, whenReady, waitForTime, waitEnd };
}
