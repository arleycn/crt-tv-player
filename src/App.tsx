import { useEffect, useRef, useState } from 'preact/hooks';
import { CrtTv } from './player/CrtTv';
import { mountPlayer } from './player';
import { loadChannels, type Channel } from './player/sequence';

/** false = 首屏待机，按电源键通电（有声自动播放需要用户手势）。
 *  页面里已有手势时改 true 可打开即播。 */
const AUTO_BOOT = false;

export function App() {
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const tvRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLElement>(null);

  // 片源单只拉一次
  useEffect(() => {
    let alive = true;
    loadChannels().then((c) => {
      if (alive) setChannels(c ?? []);
    });
    return () => {
      alive = false;
    };
  }, []);

  // 播放器只在片源就绪后挂一次。电源键是「待机」，由播放器原生接管，
  // 不走这里 —— 否则 React 重渲染会覆盖播放器注入的屏幕 DOM 与状态类。
  useEffect(() => {
    const tv = tvRef.current;
    const root = rootRef.current;
    if (!channels || !tv || !root) return;
    const handle = mountPlayer({ tv, root, channels, autoBoot: AUTO_BOOT });
    return () => handle.cleanup();
  }, [channels]);

  return (
    <main class="crtv" ref={rootRef}>
      <section class="crtv__stage">
        <CrtTv tvRef={tvRef} on={AUTO_BOOT} />
      </section>
    </main>
  );
}
