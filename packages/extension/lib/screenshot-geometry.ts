/**
 * 截图几何（纯逻辑，零 chrome.* 依赖）：截图尺寸计算 + 图片坐标 → CSS 坐标换算。
 *
 * 宿主（Claude API 等）会把超限图片再缩放一次，模型量到的坐标随之错位（2560 宽视口
 * 实测 0.78 倍）。所以扩展先按标准档规则缩好：长边 ≤ 1568，且视觉 token
 * ⌈w/28⌉×⌈h/28⌉ ≤ 1568——落在此范围内的图片任何档位都不会被二次缩放。
 * 规则与参考实现见 https://platform.claude.com/docs/en/build-with-claude/vision-coordinates
 */

export const MAX_IMAGE_EDGE = 1568
export const MAX_IMAGE_TOKENS = 1568
const PATCH = 28

export interface Size {
  readonly width: number
  readonly height: number
}

/** Python round() 同款的银行家舍入：API 在 .5 处取偶数，Math.round 会算出不同尺寸。 */
function roundTiesToEven(value: number): number {
  const floor = Math.floor(value)
  if (value - floor !== 0.5) return Math.round(value)
  return floor % 2 === 0 ? floor : floor + 1
}

function fits(width: number, height: number, maxEdge: number, maxTokens: number): boolean {
  return (
    Math.ceil(width / PATCH) * PATCH <= maxEdge &&
    Math.ceil(height / PATCH) * PATCH <= maxEdge &&
    Math.ceil(width / PATCH) * Math.ceil(height / PATCH) <= maxTokens
  )
}

/** 保持宽高比、同时满足长边与 token 上限的最大尺寸；已满足时原样返回。 */
export function fitImageSize(
  width: number,
  height: number,
  maxEdge: number = MAX_IMAGE_EDGE,
  maxTokens: number = MAX_IMAGE_TOKENS,
): Size {
  if (fits(width, height, maxEdge, maxTokens)) return {width, height}
  if (height > width) {
    const rotated = fitImageSize(height, width, maxEdge, maxTokens)
    return {width: rotated.height, height: rotated.width}
  }
  const aspect = width / height
  const shortEdge = (long: number): number => Math.max(roundTiesToEven(long / aspect), 1)
  // 沿长边二分：lo 恒满足、hi 恒不满足
  let lo = 1
  let hi = width
  while (lo + 1 < hi) {
    const mid = Math.floor((lo + hi) / 2)
    if (fits(mid, shortEdge(mid), maxEdge, maxTokens)) lo = mid
    else hi = mid
  }
  return {width: lo, height: shortEdge(lo)}
}

/** 一次截图的几何：视口 CSS 尺寸与实际回传的图片尺寸。 */
export interface ScreenshotGeometry {
  readonly cssWidth: number
  readonly cssHeight: number
  readonly imageWidth: number
  readonly imageHeight: number
}

export type ImagePointResult =
  | {readonly ok: true; readonly x: number; readonly y: number}
  | {readonly ok: false; readonly reason: string}

/** 坐标保留一位小数：CDP 接受小数坐标，过度精度只会让回执难读。 */
function round1(value: number): number {
  return Math.round(value * 10) / 10
}

/**
 * 把截图上量到的点换算成视口 CSS 坐标。视口尺寸自截图后变过就拒绝：
 * 旧图的比例不再成立，静默换算会点歪。
 */
export function imagePointToCss(
  geometry: ScreenshotGeometry | undefined,
  viewport: Size,
  x: number,
  y: number,
): ImagePointResult {
  if (geometry === undefined) {
    return {ok: false, reason: 'no screenshot of this tab in the current extension session — call screenshot first'}
  }
  if (geometry.cssWidth !== viewport.width || geometry.cssHeight !== viewport.height) {
    return {
      ok: false,
      reason:
        `the viewport changed from ${geometry.cssWidth}x${geometry.cssHeight} to ${viewport.width}x${viewport.height} ` +
        'since the last screenshot — take a new screenshot and measure again',
    }
  }
  if (x < 0 || y < 0 || x > geometry.imageWidth || y > geometry.imageHeight) {
    return {
      ok: false,
      reason: `(${x}, ${y}) is outside the ${geometry.imageWidth}x${geometry.imageHeight} screenshot`,
    }
  }
  return {
    ok: true,
    x: round1((x * geometry.cssWidth) / geometry.imageWidth),
    y: round1((y * geometry.cssHeight) / geometry.imageHeight),
  }
}

/** 每个 tab 最近一次截图的几何。SW 重启即丢失，换算时按「未截图」显式报错。 */
const lastGeometry = new Map<number, ScreenshotGeometry>()

export function rememberScreenshot(tabId: number, geometry: ScreenshotGeometry): void {
  lastGeometry.set(tabId, geometry)
}

export function lastScreenshot(tabId: number): ScreenshotGeometry | undefined {
  return lastGeometry.get(tabId)
}

export function forgetScreenshot(tabId: number): void {
  lastGeometry.delete(tabId)
}
