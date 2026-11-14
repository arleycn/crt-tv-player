/**
 * 播放器几何 · 唯一来源
 *
 * 老 CRT 从外到内四圈，全部由同一组数推导：
 *   机壳斜面（外框）→ 开口内沿（洞）→ 玻璃外圈 → 荧光屏（唯一发光区）
 * 任何层要边界都从这里取，不许在组件、样式、着色器里再写第二个数字。
 *
 * 消费方：
 *  · CrtTv.tsx      → #crt-curve 凸面裁剪曲线、整圈连续斜面、玻璃描边
 *  · player/tube.ts → 外沿黑边 uFrame、纹理缩放 TUBE_INSET、贴面弧度 CURVATURE
 *  · tv.css        → 下巴布局与玻璃外圈物理尺寸（CSS 常量，与曲线几何无关）
 *  · verify-tv.mjs  → 结构不变量对账
 *
 * 坐标是相对屏幕自身宽 / 高的 0..1 比例。objectBoundingBox 的 x 相对宽、
 * y 相对高，4:3 屏幕上同一个数字横向比纵向长 1/3，所以横向基准统一乘
 * SCREEN_AR 换算到纵向，四边内缩在物理像素上才等宽。
 */
export const SCREEN_AR = 4 / 3;

/** 凸面曲线三个数 —— 调弧度只改这里，其余链路全部跟着变 */
const CORNER_X = 0.088;
const MID_X = 0.0507;
const BULGE_Y = 0.80;

/** 内容贴着凸面走的桶形外推量，与轮廓曲线同源 */
export const CURVATURE = 0.10;

/**
 * 显示分工（2026-11-14 订正）：这里只管「曲线几何」。
 * 玻璃外圈 2px / 淡入过渡带 1px 是显示屏幕的物理尺寸常量，归 tv.css 的
 * --crt-glass-ring / --crt-glass-fade 两个变量，由荧光屏盒子的 inset 与
 * 内容层边缘渐变实现；不再由 SVG filter/mask 盖在铺满的视频上。
 * 两边职责不同，任何一方都不许硬编码对方的数字。
 */

/** 凸面内框：CrtDefs / CrtBezel / 着色器外沿黑边共用 */
export const FRAME = {
  /** 四角横向内缩，相对宽 */
  cornerX: CORNER_X,
  /** 四角纵向内缩，相对高 */
  cornerY: CORNER_X * SCREEN_AR,
  /** 左右边中横向内缩，相对宽 */
  midX: MID_X,
  /** 上下边中纵向内缩，相对高 */
  midY: MID_X * SCREEN_AR * BULGE_Y,
} as const;

/**
 * 管面纹理缩放：让「内框可见区」正对应完整源图，越界那段藏在斜面下。
 * 绝不能改成 uv = warped / warpMax 那种归一化 —— 那会先把源图边缘 5% 丢掉，
 * 再被内框裁一圈，顶部 MARIO 分数与底部砖块就是这么没的。
 */
export const TUBE_INSET = 1 / (1 - 2 * FRAME.midX);

/** 荧光屏（唯一发光区）相对屏幕的可见比例 */
export const VISIBLE_RATIO = {
  x: 1 - 2 * FRAME.midX,
  y: 1 - 2 * FRAME.midY,
} as const;

/** 结构不变量：给 verify-tv.mjs 对账，防止再出现三处人肉同步 */
export const GEOMETRY_INVARIANTS = {
  screenAr: SCREEN_AR,
  frame: FRAME,
  tubeInset: TUBE_INSET,
  curvature: CURVATURE,
  visibleRatio: VISIBLE_RATIO,
} as const;
