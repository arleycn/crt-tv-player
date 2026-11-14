# crt-tv-player · 老电视机视频播放器

一台用纯前端复刻的显像管（CRT）电视机：通电、搜台、放片、换台、调音量，全在一台 4:3 的小电视里完成。视频源由一份「片源单」驱动，可以指向本地文件，也可以指向任意 https 地址。

本项目是从线上站点 `fun.arley.cn` [童年体验馆](https://fun.arley.cn/)的「电视机模块」单独抽离出来的**开源可复用版本**：

- ✅ **复刻**：整台电视机的视觉与交互和基本功能。
- 🧹 **删除**：原项目的触发逻辑。
- ✍️ **添加**：本地视频播放。

> 一句话：它现在就是「一台能放视频的老电视机」。


---

## 特性

- **老电视质感**：纯 CSS + WebGL 着色器画出的凸面荧光屏（曲率 / 扫描线 / 暗角 / RGB 偏移 / 噪声 / 亮度晕），开机有「一条亮线展开成整屏」的 CRT 通电动画。
- **信号兜底**：视频没就绪 / 卡住 / 断流时，自动退回「雪花 + 彩条测试卡 + 一句老电视口吻的文案」（三者同时显示），不露黑屏。
- **片源单（频道列表）**：桌面贴右侧全高（≤900px 变底部抽屉），点一下换台；当前播放的台有高亮与脉冲指示，放不出来的台标「信号弱」而不弹窗报错。播放中自动压暗、可收起、收起后有展开标签。
- **片单通电后淡入**：首屏待机时片单不显示；按电源键通电后，片单从右侧（≤900px 变底部抽屉）淡入，电视同步让位。几秒不操作自动压到 0.4 亮度，鼠标移上去或键盘聚焦立刻全亮；可收起，收起后留「片单 N」展开标签。
- **本地视频文件**：点片单底部的「＋ 本地文件」选择本机 `.mp4`，直接以 `blob:` 同源播放，无需任何 CORS 或外链。
- **换台 / 音量**：电视下巴四颗软键（▲▼ 换台、＋− 音量），也可只用键盘（↑↓ 换台、± 调音量）。电源键把整机切到待机（画面坍缩成亮线、片单保持原样），再按一次重新通电（重放亮线展开动画，片单保持原样不动）。
- **零素材零请求**：机壳、雪花、彩条、开机亮线全部由代码生成，整个 UI 不依赖任何外部图片 / 字体。
- **优雅降级**：WebGL 挂不上时，退回原生 `<video>` + CSS 玻璃层，照样能看，绝不黑屏。
- **纯前端、可复用**：核心播放逻辑封装在 `mountPlayer()`，传给它「一台 `.crt` 电视 + 它的舞台根 `.crtv` + 一份片源单」即可，不绑定任何框架（页面层用 Preact 演示，可替换）。

---

## 技术栈

- [Preact 10](https://preactjs.com/) + [Vite 7](https://vitejs.dev/) + TypeScript 5
- 无运行时第三方依赖（生产依赖只有 `preact`）
- WebGL（原生，无 three.js 等）做显像管管面；Canvas 2D 做无信号雪花

---

## 快速开始

```bash
npm install      # 安装依赖
npm run dev      # 本地开发，默认 http://localhost:5173
npm run build    # 类型检查 + 生产构建到 dist/
npm run preview  # 预览构建产物
```

`public/media/egg-07-desk-v2.mp4` 是随仓库附带的演示片源（约 920 KB，纯本地、零外链）。`npm run dev` 后打开页面，电视默认处于**待机**状态，按一下下巴左侧的电源键（⏻）即通电搜台、开始播放。

### GitHub Pages 自动部署

`.github/workflows/deploy.yml` 会在 **push 到 `master`** 时自动执行 `npm ci → npm run build → 把 dist/ 推到 gh-pages 分支**（`peaceiris/actions-gh-pages@v4`，自动补 `.nojekyll`）。仓库 Settings → Pages 选 `gh-pages` / `(root)` 即可，之后只管改 `master`，预览会自动更新。也可在 Actions 页手动 `Run workflow`。

构建产物用相对路径（`base: './'`），部署在 `/crt-tv-player/` 之类的子路径或自定义域名根都能用。

---

## 换成你自己的视频

片源由根目录的 **`public/channels.json`** 一份数组驱动：

```json
{
  "channels": [
    {
      "src": "media/egg-07-desk-v2.mp4",
      "title": "桌角时光 · 怀旧频道",
      "year": 2026,
      "studio": "本机片源"
    }
  ]
}
```

| 字段 | 说明 |
| --- | --- |
| `src` | **必填**。允许四类值：① 站内相对路径（如 `media/xxx.mp4`，推荐，可部署在任意子路径，文件放 `public/media/` 下）；② `https://` 绝对地址（需返回正确 CORS 头，见下方「片源接入」一节）；③ `blob:`（由「本地文件」按钮产生）；④ `http://` 仅限 `localhost` / `127.0.0.1` 本地调试。其余协议（`data:` / `file:` / `javascript:` 等）会被拒绝并控制台告警。 |
| `title` | **必填**。频道名，显示在片源单里。 |
| `year` | 选填。年代，显示在副标题。 |
| `studio` | 选填。出品方，显示在副标题。 |
| `duration` | 选填。单集秒数，用于片源单抬头那句「约 N 分钟」（缺省则不显示）。 |

改片源只要两步：

1. 把你的视频丢进 `public/media/`（**想内存小就存本地**，也支持直接填外链 https）；
2. 在 `channels.json` 里加一条（或换成你自己的列表），**刷新页面**即可生效（片源单只在页面加载时拉取一次）。

> 想播外链 / 对象存储片源？它必须返回正确的 CORS 头（`Access-Control-Allow-Origin`）才能接进 WebGL 管面，否则会触发「信号弱」兜底（不崩）。不同存储的 CORS 配置见下方「片源接入（外链 / 对象存储）」一节。

---

## 片源接入（外链 / 对象存储）

`channels.json` 的 `src` 只接受四类值（见上表）：站内相对路径、<code>https://</code>、<code>blob:</code>（本地文件）、<code>http://</code> 仅 localhost。下面讲外链和对象存储的接入方式。

### 来源对照

| 来源 | 示例 `src` | CORS 要求 | 备注 |
| --- | --- | --- | --- |
| 本地文件 | `media/x.mp4` | 无 | 随仓库部署，最稳，推荐 |
| 任意 https 直链 | `https://cdn.example.com/x.mp4` | 需 | 对方服务器回 ACAO |
| Cloudflare R2 | `https://<id>.r2.dev/...` 或自定义域 | 需（桶 CORS） | 见下 |
| S3 兼容桶 | COS / OSS / B2 / MinIO / Supabase | 需（桶 CORS） | 见下 |

### Cloudflare R2 逐步接入

1. **公开桶 + 公开访问域**：在 R2 桶设置里开「公开访问」，得到 `https://<bucket>.<id>.r2.dev/...` 域名（或绑自定义域），并把对象设公共可读。
2. **配置桶 CORS**（否则 WebGL 管面读像素会被浏览器拦）。写一份 `cors.json`：

```json
[
  {
    "AllowedOrigins": ["https://你的站点域名", "https://你的仓库.pages.dev"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["Content-Range", "Content-Length", "ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

用 `wrangler`（需已登录）应用：

```bash
wrangler r2 bucket cors set <你的桶名> --file cors.json
```

3. **Range / 206**：视频拖动进度依赖 `Range` 请求，R2 默认返回 `206 Partial Content`，无需额外配置。
4. **Content-Type**：确保对象 `Content-Type: video/mp4`（上传时指定，或桶的默认 MIME 映射正确），否则浏览器不认视频。

> **私有桶不要把预签名 URL 写死在公开的 `channels.json` 里**：预签名 URL 带过期签名，到点即失效，写死会让片源单在过期后集体「信号弱」；而且公开 JSON 里的 URL 等于把临时授权发给任何拿到 JSON 的人。私有内容请走一个会按需签名的 Worker / 函数，把签名过程留在服务端。

### S3 兼容存储（AWS S3 / 腾讯云 COS / 阿里云 OSS / Backblaze B2 / MinIO / Supabase Storage）

CORS 规则与上面 R2 的 JSON 等价，只是配置入口不同（各厂商控制台或 CLI 的「跨域访问 / CORS」项）。通用要点：

- `AllowedOrigins` 填**你站点的确切来源**（含协议和端口），不要只填 `*`——播放器以 `crossOrigin="anonymous"` 取流，部分浏览器对匿名请求要求显式来源。
- `AllowedMethods` 至少含 `GET` / `HEAD`。
- 开启 `Range` 支持与正确的 `Content-Type`，否则无法拖动进度。

### 明确不支持的片源

- **YouTube / B 站等页面链接**：那是网页 URL，不是视频文件直链，且几乎不返回 CORS，无法接入。
- **iframe 嵌入**：本项目是 WebGL 直接解码视频流，不支持 iframe 套娃。
- **无 CORS 的第三方资源**：会触发「信号弱」兜底，不会崩，但也放不出来。
- **HLS（`.m3u8`）**：Chrome 原生不支持 HLS，需额外 hls.js 且本项目未内置，暂不支持。

### 上线前自检（`curl -I`）

```bash
curl -I https://你的片源地址.mp4
```

期待看到：`HTTP/2 206`（或 `200`）、`content-type: video/mp4`、`accept-ranges: bytes`，以及跨域请求下的 `access-control-allow-origin: <你的站点>`。带 `Origin` 验证 CORS：

```bash
curl -I -H "Origin: https://你的站点" https://你的片源地址.mp4
```

### 编码与体积建议

- 封装 **MP4（H.264 视频 + AAC 音频）**，浏览器兼容性最好；务必 **faststart**（moov atom 前置），否则首帧要等整段下载完。
- 演示片源仅 ~920 KB；自托管建议单文件控制在几 MB～几十 MB，移动端更友好。

---

## 交互一览

| 操作 | 方式 |
| --- | --- |
| 开机 | 首屏**待机**（电视居中、无片单）；按电源键通电：亮线展开 → 雪花 + 彩条 → 搜台 → 播第一个台。浏览器禁止无手势自动播放声音，故「按电源键」既是动画起点也是声音解锁点（跳过待机见 `autoBoot`） |
| 换台 | 下巴 ▲▼ 软键，或键盘 ↑ / ↓ |
| 调音量 | 下巴 ＋− 软键，或键盘 `+` / `-` |
| 选台 | 点片源单里的某一行 |
| 片单淡入 / 压暗 | 通电后片单淡入；播放成功立刻压到 0.4（CSS 过渡约 300ms），鼠标移上去或键盘聚焦立刻全亮 |
| 收起片单 | 片单头部「收起」按钮；面板滑出画外，电视回到视口正中 |
| 展开片单 | 收起后点右侧（手机底部）「片单 N」标签 |
| 待机 / 通电 | 下巴左侧电源键（⏻）；画面坍缩成一条亮线，再按重新通电 |

---

## 目录结构

```
crt-tv-player/
├─ index.html                 # 入口 HTML
├─ vite.config.ts
├─ tsconfig.json
├─ package.json
├─ public/
│  ├─ channels.json           # 片源单（频道列表）
│  ├─ media/
│  │  └─ egg-07-desk-v2.mp4    # 附带演示片源
│  └─ favicon.svg
└─ src/
   ├─ main.tsx                # 渲染入口（挂 CrtDefs + App）
   ├─ App.tsx                 # 演示装配：渲染电视 + 拉片源单 + 挂载播放器
   ├─ styles/
   │  ├─ tokens.css           # 设计变量
   │  ├─ base.css             # 页面布局（电视 + 片源单）
   │  └─ tv.css               # 电视机全部样式（唯一来源）
   └─ player/                # ── 可复用电视机内核（与框架无关）──
      ├─ CrtTv.tsx            # 电视机 DOM（机壳 / 斜面 / 玻璃 / 下巴 / 电源键）
      ├─ geometry.ts          # 凸面曲线几何（与着色器同源）
      ├─ tube.ts              # WebGL 显像管管面着色器
      ├─ view.ts              # 管面挂载 / 状态类 / 降级 / 释放
      ├─ signal.ts            # 雪花 / 彩条测试卡 / 状态文案
      ├─ media.ts             # 媒体运行时工具（等待 / 可播 / abort）
      ├─ controller.ts        # 换台 / 音量 / OSD 纯规则
      ├─ sequence.ts          # 片源单加载与校验
      ├─ layout.ts            # 舞台几何 / 首帧同步布局（缩放居中 + 让位）
      ├─ player.ts            # 编排：开机 → 搜台 → 播放 → 换台 → 兜底
      └─ index.ts             # 对外入口 mountPlayer()

> `mountPlayer()` 还提供几个扩展点：`autoBoot?: boolean`（默认 `false`，跳过待机直接通电）、`addLocalFiles(FileList)`（运行时追加本地视频为频道）、`loadChannels(url?)`（自定义片源单路径，默认读 `channels.json`）。
```

### 在你的项目里复用

核心逻辑不依赖 Preact。拿到一台符合以下结构的 `.crt` 电视元素，调用：

```ts
import { mountPlayer, type PlayerOptions } from './player';

const handle = mountPlayer({
  tv: document.querySelector('.crt')!,          // 整机，父元素即舞台容器
  root: document.querySelector('.crtv')!,       // 舞台根：片单 + 状态类挂这里
  channels: [{ src: 'media/a.mp4', title: '频道一' }],
  initialVolume: 0.9,
});

handle.setPower(false);  // 程序化待机（可选；电源键已由播放器原生接管）
handle.cleanup();        // 卸载并复位
```

`.crt` 需要包含 `.crt__aperture` / `.crt__screen` / `.crt__chin`（直接渲染 `<CrtTv>` 即可获得），其父元素作为缩放居中的舞台；页面根部还需渲染一次 `<CrtDefs/>` 提供曲线 clip-path。片单与状态类由播放器挂到 `root`，无需你预先准备容器。

`mountPlayer()` 挂载时会同步做一次布局，所以直接复用也不会停在左上角。若想连**首次绘制**都零跳变，在渲染之后、同一个同步任务里再调一次 `layoutStageFirstPaint(stage, root)`（本仓库的 `main.tsx` 就是这么做的）。

> 电源键由播放器原生监听（与 `arley-fun` 的 `egg-film.ts` 一致），不要再给它绑 React `onClick`；`setPower()` 只是预留给外部控制的同一入口。

---

## 开源协议

[MIT](./LICENSE)。随附的演示片源 `egg-07-desk-v2.mp4` 仅作演示用途，替换为你自己的素材后再分发（演示片源版权归原作者，本项目不主张其权利）。
