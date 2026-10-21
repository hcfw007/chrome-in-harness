import {describe, expect, test} from 'vitest'
import {buildHitTestScript, parseHitTestResult} from './hit-test.js'

describe('buildHitTestScript', () => {
  test('is a read-only IIFE using elementFromPoint at the given coordinates', () => {
    const script = buildHitTestScript(12.5, 40)
    expect(script.trimStart().startsWith('(() =>')).toBe(true)
    expect(script).toContain('document.elementFromPoint(12.5, 40)')
    expect(script).toContain('shadowRoot.elementFromPoint')
    // 空白区域（html/body）按无命中处理，不回传整页文本
    expect(script).toContain('el === document.documentElement || el === document.body')
    for (const banned of ['innerHTML', 'outerHTML', '.click(', 'dispatchEvent', 'fetch(']) {
      expect(script).not.toContain(banned)
    }
  })
})

describe('parseHitTestResult', () => {
  test('keeps a well-formed hit with its interactive ancestor', () => {
    const hit = parseHitTestResult({
      tag: 'span',
      text: '保存',
      rect: {x: 10, y: 20, width: 30, height: 12},
      interactive: {tag: 'button', text: '保存'},
    })
    expect(hit).toEqual({
      tag: 'span',
      text: '保存',
      rect: {x: 10, y: 20, width: 30, height: 12},
      interactive: {tag: 'button', text: '保存'},
    })
  })

  test('drops empty optional fields and flags iframes', () => {
    const hit = parseHitTestResult({tag: 'iframe', id: '', role: '', text: '', rect: {}, inIframe: true})
    expect(hit).toEqual({tag: 'iframe', text: '', rect: {x: 0, y: 0, width: 0, height: 0}, inIframe: true})
  })

  test('null or malformed payloads mean no hit', () => {
    expect(parseHitTestResult(null)).toBeNull()
    expect(parseHitTestResult('div')).toBeNull()
    expect(parseHitTestResult({text: 'no tag'})).toBeNull()
  })
})

describe('buildHitTestScript input guard', () => {
  test('throws on non-number coordinates instead of interpolating them', () => {
    expect(() => buildHitTestScript('1);0;(1' as unknown as number, 1)).toThrow(/finite number/)
    expect(() => buildHitTestScript(1, Number.NaN)).toThrow(/finite number/)
    expect(() => buildHitTestScript(1, Number.POSITIVE_INFINITY)).toThrow(/finite number/)
  })
})
