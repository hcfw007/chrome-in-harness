import {describe, expect, test} from 'vitest'
import {buildOcclusionFn, parseOcclusion} from './occlusion.js'

describe('buildOcclusionFn', () => {
  test('embeds the exact click coordinates', () => {
    const fn = buildOcclusionFn(120.5, 40)
    expect(fn).toContain('let x = 120.5, y = 40')
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

describe('buildOcclusionFn 跨同源 iframe', () => {
  /** 假 DOM：顶层两个 iframe（A 在左 0..300，B 绝对定位可能盖住 A），各含一个 textarea。 */
  function setup(bOverA: boolean) {
    const topWin: Record<string, unknown> = {frameElement: null}
    topWin['parent'] = topWin
    const style = {paddingLeft: '0', paddingTop: '0'}
    topWin['getComputedStyle'] = () => style
    const topDoc: Record<string, unknown> = {defaultView: topWin}
    const makeFrame = (left: number) => {
      const frame: Record<string, unknown> = {
        tagName: 'IFRAME',
        ownerDocument: topDoc,
        clientLeft: 0,
        clientTop: 0,
        getBoundingClientRect: () => ({left, top: 0}),
      }
      const win: Record<string, unknown> = {frameElement: frame}
      win['parent'] = topWin
      const input: Record<string, unknown> = {nodeType: 1, tagName: 'TEXTAREA', contains: (n: unknown) => n === input}
      const doc: Record<string, unknown> = {defaultView: win, elementFromPoint: () => input}
      input['ownerDocument'] = doc
      return {frame, input}
    }
    const a = makeFrame(0)
    const b = makeFrame(bOverA ? 0 : 400)
    topDoc['elementFromPoint'] = (x: number) => (bOverA || x >= 400 ? b.frame : a.frame)
    return {a, b}
  }
  const run = (self: unknown, x: number, y: number): unknown =>
    (new Function(`return (${buildOcclusionFn(x, y)})`)() as (this: unknown) => unknown).call(self)

  test('目标 iframe 在该点可见：clear', () => {
    const {a} = setup(false)
    expect(run(a.input, 50, 20)).toEqual({kind: 'clear'})
  })

  test('另一个 iframe 盖在目标 iframe 上：covered（不点击）', () => {
    const {a} = setup(true)
    expect(run(a.input, 50, 20)).toMatchObject({kind: 'covered', tag: 'iframe'})
  })
})
