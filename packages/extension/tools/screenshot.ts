/**
 * screenshot 工具实现：原分辨率截图 → 缩到「宿主不会再二次缩放」的尺寸（见 lib/screenshot-geometry）。
 * 图片像素与 CSS 像素的比例如实回报；click_at({space:"image"}) 按本 tab 最近一次截图换算。
 */
import {ensureAttached} from '../lib/cdp'
import {captureScreenshot, getViewportMetrics} from '../lib/cdp-commands'
import {downscalePng, readPngSize} from '../lib/image-scale'
import {fitImageSize, rememberScreenshot} from '../lib/screenshot-geometry'
import {authorizeTab} from './access'

import type {ToolHandler} from './types'

function base64PngSize(base64: string): {width: number; height: number} | null {
  // IHDR 宽高在前 24 字节内，只解码开头一小段
  const head = atob(base64.slice(0, 32))
  const bytes = new Uint8Array(head.length)
  for (let i = 0; i < head.length; i += 1) bytes[i] = head.charCodeAt(i)
  return readPngSize(bytes)
}

export const screenshot: ToolHandler = async (params) => {
  const {tabId} = params as {tabId?: number}
  const target = await authorizeTab(tabId)
  await ensureAttached(target.tabId)
  const metrics = await getViewportMetrics(target.tabId)
  const raw = await captureScreenshot(target.tabId)
  const base = {mimeType: 'image/png', width: metrics.width, height: metrics.height, dpr: metrics.dpr}
  const cssWidth = Math.round(metrics.width)
  const cssHeight = Math.round(metrics.height)

  let data = raw
  if (cssWidth > 0 && cssHeight > 0) {
    const fitted = fitImageSize(cssWidth, cssHeight)
    try {
      data = await downscalePng(raw, fitted.width, fitted.height)
    } catch (error) {
      // 缩放失败退回原图，下面按原图真实尺寸回报比例，绝不让调用方误以为图片是 CSS 像素
      console.warn('[screenshot] downscale failed:', error instanceof Error ? error.message : error)
    }
  }

  const size = base64PngSize(data)
  if (size === null || cssWidth <= 0 || cssHeight <= 0) {
    return {...base, data, scale: 1}
  }
  rememberScreenshot(target.tabId, {cssWidth, cssHeight, imageWidth: size.width, imageHeight: size.height})
  return {
    ...base,
    data,
    imageWidth: size.width,
    imageHeight: size.height,
    // 图片像素 / CSS 像素
    cssScale: size.width / cssWidth,
    // 兼容旧字段：图片像素 / 设备像素
    scale: size.width / (cssWidth * metrics.dpr),
  }
}
