import { render } from 'preact';
import { App } from './App';
import { CrtDefs } from './player/CrtTv';
import { layoutStageFirstPaint } from './player/layout';
import './styles/tokens.css';
import './styles/base.css';
import './styles/tv.css';

const root = document.getElementById('app');
if (root) {
  render(
    <>
      <CrtDefs />
      <App />
    </>,
    root,
  );
  // 与 render() 同一个同步 task：浏览器首次绘制之前就把电视放到最终位置。
  // 待机首屏（.crt.is-off）片单还没出现，按全视口居中；通电后片单淡入再让位。
  const stage = root.querySelector<HTMLElement>('.crtv__stage');
  const crtv = root.querySelector<HTMLElement>('.crtv');
  if (stage && crtv) {
    const withDial = !crtv.querySelector('.crt')?.classList.contains('is-off');
    layoutStageFirstPaint(stage, crtv, withDial);
  }
}
