/**
 * 截图降采样：把设备像素截图缩到 CSS 像素尺寸。
 * 不走 Page.captureScreenshot 的 clip.scale——实测该参数在部分 Chromium 版本上会把视口
 * 平铺渲染成 2x2（或在滚动后截到空白），因此改为原分辨率截图后在 SW 内用 OffscreenCanvas 缩放。
 */

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64)
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

/** PNG 头部 IHDR 中的宽高（大端 u32，偏移 16/20）；非 PNG 返回 null。 */
export function readPngSize(bytes: Uint8Array): {width: number; height: number} | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (bytes.length < 24 || signature.some((b, i) => bytes[i] !== b)) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return {width: view.getUint32(16), height: view.getUint32(20)}
}

/**
 * 把 base64 PNG 缩放到目标尺寸并返回 base64 PNG。
 * 原图已经是目标尺寸（dpr=1）时原样返回，避免无意义的重编码。
 */
export async function downscalePng(base64: string, width: number, height: number): Promise<string> {
  const bytes = base64ToBytes(base64)
  const size = readPngSize(bytes)
  if (size !== null && size.width === width && size.height === height) return base64
  const bitmap = await createImageBitmap(new Blob([bytes], {type: 'image/png'}))
  try {
    const canvas = new OffscreenCanvas(width, height)
    const context = canvas.getContext('2d')
    if (context === null) throw new Error('OffscreenCanvas 2d context unavailable')
    context.imageSmoothingQuality = 'high'
    context.drawImage(bitmap, 0, 0, width, height)
    const blob = await canvas.convertToBlob({type: 'image/png'})
    return bytesToBase64(new Uint8Array(await blob.arrayBuffer()))
  } finally {
    bitmap.close()
  }
}
