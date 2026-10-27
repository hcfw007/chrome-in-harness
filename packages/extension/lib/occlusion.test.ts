import {describe, expect, test} from 'vitest'
import {buildOcclusionFn, parseOcclusion} from './occlusion.js'

describe('buildOcclusionFn', () => {
  test('embeds the exact click coordinates', () => {
    const fn = buildOcclusionFn(120.5, 40)
    expect(fn).toContain('document.elementFromPoint(120.5, 40)')
  })

  test('refuses non-finite coordinates instead of building a script', () => {
    expect(() => buildOcclusionFn(Number.NaN, 1)).toThrow()
    expect(() => buildOcclusionFn('1);alert(1);(1' as unknown as number, 1)).toThrow()
  })
})

describe('parseOcclusion', () => {
  test('describes the covering element', () => {
    expect(parseOcclusion({kind: 'covered', tag: 'div', cls: 'ant-modal-wrap'})).toEqual({
      kind: 'covered',
      by: '<div class="ant-modal-wrap">',
    })
    expect(parseOcclusion({kind: 'covered', tag: 'div', id: 'mask', text: 'Loading'})).toEqual({
      kind: 'covered',
      by: '<div#mask> "Loading"',
    })
  })

  test('passes clear and outside through', () => {
    expect(parseOcclusion({kind: 'clear'})).toEqual({kind: 'clear'})
    expect(parseOcclusion({kind: 'outside'})).toEqual({kind: 'outside'})
  })

  test('treats malformed receipts as unknown so the check never blocks a click by itself', () => {
    expect(parseOcclusion(null)).toEqual({kind: 'unknown'})
    expect(parseOcclusion({kind: 'weird'})).toEqual({kind: 'unknown'})
  })
})
