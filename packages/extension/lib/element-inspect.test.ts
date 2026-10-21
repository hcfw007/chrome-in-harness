import {describe, expect, test} from 'vitest'
import {buildGetHtmlScript, buildProbeScript, parseHtmlResult, parseProbeResult} from './element-inspect.js'
import {describeLoadingFailure} from './network-buffer.js'

describe('probe / get_html scripts', () => {
  test('selector probe reports the match count; text probe does not', () => {
    expect(buildProbeScript({selector: '.row'})).toContain('document.querySelectorAll(".row").length')
    expect(buildProbeScript({text: '导出'})).toContain('const count = undefined')
  })

  test('scripts are read-only', () => {
    for (const script of [buildProbeScript({selector: 'a'}), buildGetHtmlScript({text: 'a'}, 100)]) {
      for (const banned of ['innerHTML =', '.click(', 'scrollIntoView', 'fetch(', 'setAttribute']) {
        expect(script).not.toContain(banned)
      }
    }
  })

  test('get_html script truncates to maxChars', () => {
    expect(buildGetHtmlScript({selector: 'main'}, 123)).toContain('html.slice(0, 123)')
  })
})

describe('parseProbeResult', () => {
  test('missing element keeps the count', () => {
    expect(parseProbeResult({exists: false, count: 0})).toEqual({exists: false, count: 0})
    expect(parseProbeResult(null)).toEqual({exists: false})
  })

  test('keeps string attrs only and defaults booleans to false', () => {
    const parsed = parseProbeResult({
      exists: true,
      rect: {x: 1, y: 2, width: 3, height: 4},
      tag: 'input',
      text: '',
      attrs: {placeholder: '筛选客户名称', bogus: 42},
    })
    expect(parsed).toEqual({
      exists: true,
      visible: false,
      inViewport: false,
      rect: {x: 1, y: 2, width: 3, height: 4},
      tag: 'input',
      text: '',
      attrs: {placeholder: '筛选客户名称'},
    })
  })
})

describe('parseHtmlResult', () => {
  test('accepts well-formed payloads and rejects missing elements', () => {
    expect(parseHtmlResult({html: '<b>x</b>', length: 8, truncated: false})).toEqual({html: '<b>x</b>', length: 8, truncated: false})
    expect(parseHtmlResult(null)).toBeNull()
    expect(parseHtmlResult({length: 3})).toBeNull()
  })
})

describe('describeLoadingFailure', () => {
  test('distinguishes canceled / blocked / cors / net errors', () => {
    expect(describeLoadingFailure({canceled: true, errorText: 'net::ERR_ABORTED'})).toBe('canceled')
    expect(describeLoadingFailure({blockedReason: 'mixed-content', errorText: 'net::ERR_BLOCKED_BY_CLIENT'})).toBe('blocked:mixed-content')
    expect(describeLoadingFailure({corsErrorStatus: {corsError: 'MissingAllowOriginHeader'}})).toBe('cors:MissingAllowOriginHeader')
    expect(describeLoadingFailure({errorText: 'net::ERR_CONNECTION_REFUSED'})).toBe('net::ERR_CONNECTION_REFUSED')
    expect(describeLoadingFailure({})).toBe('failed')
  })
})
