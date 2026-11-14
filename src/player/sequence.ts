/**
 * 片源单加载：只认 public/channels.json，不碰 DOM、不碰播放状态，可独立单测。
 * 原项目的「彩蛋编排」(clips / bgm / 开机序列) 已全部移除 —— 这里是纯播放器的片单。
 */

export interface Channel {
  src: string;
  title: string;
  year?: number;
  studio?: string;
  duration?: number;
}

/** 允许的片源地址：
 *  - 站内相对路径（media/a.mp4、./a.mp4），不能以 // 开头
 *  - https:// 任意地址（CDN / 对象存储直链必须 https）
 *  - http:// 仅 localhost / 127.0.0.1（本地开发）
 *  - blob: 本机文件（addLocalFiles 生成，与页面同源，WebGL 管面可取帧）
 *  其余 data: / file: / javascript: / ftp: 一律拒绝，别把非视频协议塞进 <video>。 */
export function channelUrlOk(src: string): boolean {
  if (!src) return false;
  if (/^blob:/i.test(src)) return true;
  if (/^(https?:)?\/\//i.test(src)) {
    try {
      const u = new URL(src, globalThis.location?.href ?? 'https://localhost/');
      const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
      return u.protocol === 'https:' || (u.protocol === 'http:' && local);
    } catch {
      return false;
    }
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(src)) return false;
  return !src.startsWith('//');
}

/** 片单校验：src 必须非空且合法，title 缺了就丢掉这一条。 */
export function normalizeChannels(raw: unknown): Channel[] | null {
  const items = Array.isArray(raw) ? raw : (raw as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) return null;
  const out: Channel[] = [];
  for (const it of items) {
    if (!it || typeof it !== 'object') continue;
    const o = it as Record<string, unknown>;
    const src = typeof o.src === 'string' ? o.src.trim() : '';
    const title = typeof o.title === 'string' ? o.title.trim() : '';
    if (!src || !title || !channelUrlOk(src)) {
      console.warn('[crt-tv-player] 已忽略无效片源（检查 src 协议与 title）：', it);
      continue;
    }
    out.push({
      src,
      title,
      year: typeof o.year === 'number' ? o.year : undefined,
      studio: typeof o.studio === 'string' ? o.studio.trim() : undefined,
      duration: typeof o.duration === 'number' && o.duration > 0 ? o.duration : undefined,
    });
  }
  return out.length ? out : null;
}

/** 默认读与页面同目录的 channels.json；复用时可传绝对/相对 URL 或自建接口地址。 */
export async function loadChannels(url = 'channels.json'): Promise<Channel[] | null> {
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) return null;
    const data = (await res.json()) as { channels?: unknown } | unknown[];
    const list = Array.isArray(data) ? data : (data as { channels?: unknown }).channels;
    return normalizeChannels(list);
  } catch {
    return null;
  }
}
