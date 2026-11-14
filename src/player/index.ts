/** 可复用内核入口：给 mountPlayer() 一台 .crt 电视 + 一份片源单即可。 */
export { mountPlayer } from './player';
export type { PlayerOptions, PlayerHandle } from './player';
export { loadChannels, normalizeChannels, channelUrlOk } from './sequence';
export type { Channel } from './sequence';
export { layoutStageFirstPaint } from './layout';
