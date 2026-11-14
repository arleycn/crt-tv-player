/**
 * 彩蛋控制器的纯规则层：只算「输入 → 状态 / 屏显文案」。
 * 不碰 DOM、不碰影片、不认片源，也不持有播放状态 —— 状态仍归编排层所有，
 * 这样开机 / 换台 / 音量 / 片单的规则只有一份，且能脱离浏览器单测。
 */

export type OsdMode = 'ch' | 'vol';

export interface OsdText {
  display: string;
  sr: string;
  lit: number;
}

/** 音量键一格 0.1，夹在 0–1；0 就是静音。 */
export function stepVolume(volume: number, dir: 1 | -1): number {
  const step = Math.max(0, Math.min(10, Math.round(volume * 10) + dir));
  return step / 10;
}

/** 换台在片单里走一格，走到头绕回另一头；curIdx < 0 表示还没选过。 */
export function nextChannelIndex(curIdx: number, dir: 1 | -1, length: number): number {
  if (length <= 0) return -1;
  const base = curIdx >= 0 ? curIdx : dir > 0 ? -1 : 0;
  return (base + dir + length) % length;
}

/** OSD 屏显与读屏文案同源；lit 是音量格数（换台态不用）。 */
export function osdText(mode: OsdMode, value: number): OsdText {
  const lit = Math.max(0, Math.min(10, Math.round(value * 10)));
  if (mode === 'ch') {
    return {
      display: `CH ${String(value).padStart(2, '0')}`,
      sr: `第 ${value} 台`,
      lit,
    };
  }
  return {
    display: '音量',
    sr: value <= 0 ? '已静音' : `音量 ${lit} 格`,
    lit,
  };
}

/** 片单抬头那个「约 N 分钟」；没有时长数据时返回 null（整段不显示）。 */
export function dialMinutes(list: readonly { duration?: number }[]): number | null {
  const total = list.reduce((sum, c) => sum + (c.duration ?? 0), 0);
  return total ? Math.round(total / 60) : null;
}
