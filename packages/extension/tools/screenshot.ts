/** screenshot 工具实现：原分辨率截图 → 缩放到 CSS 像素，图片坐标可直接用于 click_at。 */
import {ensureAttached} from '../lib/cdp'
import {captureScreenshot, getViewportMetrics} from '../lib/cdp-commands'
import {downscalePng} from '../lib/image-scale'
import {authorizeTab} from './access'

import type {ToolHandler} from './types'

export const screenshot: ToolHandler = async (params) => {
  const {tabId} = params as {tabId?: number}
  const target = await authorizeTab(tabId)
  await ensureAttached(target.tabId)
  const metrics = await getViewportMetrics(target.tabId)
  const raw = await captureScreenshot(target.tabId)
  const base = {mimeType: 'image/png', width: metrics.width, height: metrics.height, dpr: metrics.dpr}
  if (metrics.width <= 0 || metrics.height <= 0 || metrics.dpr === 1) {
    return {...base, data: raw, scale: 1}
  }
  try {
    const data = await downscalePng(raw, Math.round(metrics.width), Math.round(metrics.height))
    return {...base, data, scale: 1 / metrics.dpr}
  } catch (error) {
    // 缩放失败退回原图并如实报 scale=1，绝不让调用方误以为图片是 CSS 像素
    console.warn('[screenshot] downscale failed:', error instanceof Error ? error.message : error)
    return {...base, data: raw, scale: 1}
  }
}
