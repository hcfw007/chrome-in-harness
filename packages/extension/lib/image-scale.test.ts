import {describe, expect, test} from 'vitest'
import {downscalePng, readPngSize} from './image-scale.js'

/** 最小 PNG 头：签名 + IHDR（长度 13）+ 宽高。足够 readPngSize 解析。 */
function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  const view = new DataView(bytes.buffer)
  view.setUint32(8, 13)
  bytes.set([0x49, 0x48, 0x44, 0x52], 12) // IHDR
  view.setUint32(16, width)
  view.setUint32(20, height)
  return bytes
}

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
}

describe('readPngSize', () => {
  test('reads width/height from the IHDR chunk', () => {
    expect(readPngSize(pngHeader(2560, 1267))).toEqual({width: 2560, height: 1267})
  })

  test('returns null for non-PNG or truncated input', () => {
    expect(readPngSize(new Uint8Array([1, 2, 3]))).toBeNull()
    const jpeg = new Uint8Array(32)
    jpeg.set([0xff, 0xd8, 0xff], 0)
    expect(readPngSize(jpeg)).toBeNull()
  })
})

describe('downscalePng', () => {
  test('returns the input untouched when it already has the target size (no re-encode)', async () => {
    const base64 = toBase64(pngHeader(800, 600))
    await expect(downscalePng(base64, 800, 600)).resolves.toBe(base64)
  })
})
