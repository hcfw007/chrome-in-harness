import {describe, expect, test} from 'vitest'
import {fitImageSize, imagePointToCss} from './screenshot-geometry.js'

describe('fitImageSize', () => {
  test('matches the documented reference implementation', () => {
    expect(fitImageSize(1920, 1080)).toEqual({width: 1456, height: 819})
    expect(fitImageSize(3840, 2160)).toEqual({width: 1456, height: 819})
    // 文档表格写 1269x952，但文档自带的参考实现（Python/TS）算出 1270x952；以参考实现为准
    expect(fitImageSize(2000, 1500)).toEqual({width: 1270, height: 952})
    expect(fitImageSize(1075, 1520)).toEqual({width: 924, height: 1307})
    expect(fitImageSize(2560, 1267)).toEqual({width: 1568, height: 776})
  })

  test('leaves images that already fit unchanged', () => {
    expect(fitImageSize(1000, 1000)).toEqual({width: 1000, height: 1000})
    expect(fitImageSize(200, 200)).toEqual({width: 200, height: 200})
  })

  test('shrinks the 2560-wide viewport from the field report under both limits', () => {
    const {width, height} = fitImageSize(2560, 1267)
    expect(width).toBeLessThanOrEqual(1568)
    expect(Math.ceil(width / 28) * Math.ceil(height / 28)).toBeLessThanOrEqual(1568)
    expect(width / height).toBeCloseTo(2560 / 1267, 2)
  })
})

describe('imagePointToCss', () => {
  const geometry = {cssWidth: 2560, cssHeight: 1267, imageWidth: 1568, imageHeight: 776}
  const viewport = {width: 2560, height: 1267}

  test('scales image coordinates back to CSS pixels', () => {
    // 战报里 getBoundingClientRect 量到 (270,174)：在 1568 宽的图上约为 (165.4,106.6)
    expect(imagePointToCss(geometry, viewport, 165.4, 106.6)).toEqual({ok: true, x: 270, y: 174})
  })

  test('rejects when no screenshot was taken', () => {
    const result = imagePointToCss(undefined, viewport, 1, 1)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('call screenshot first')
  })

  test('rejects when the viewport was resized after the screenshot', () => {
    const result = imagePointToCss(geometry, {width: 1512, height: 900}, 10, 10)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('take a new screenshot')
  })

  test('rejects points outside the image', () => {
    expect(imagePointToCss(geometry, viewport, 1569, 10).ok).toBe(false)
    expect(imagePointToCss(geometry, viewport, -1, 10).ok).toBe(false)
  })
})
