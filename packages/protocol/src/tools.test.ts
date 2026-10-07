import {describe, expect, test} from 'vitest'
import {
  TOOL_ERROR_CODES,
  addAllowlistDomainParams,
  clickAtParams,
  clickParams,
  getTextParams,
  getTextResult,
  navigateParams,
  pressKeyParams,
  readConsoleParams,
  readNetworkParams,
  scrollParams,
  snapshotParams,
  snapshotResult,
  tabSelectParams,
  takeoverTabParams,
  typeParams,
  waitParams,
} from './tools.js'

describe('TOOL_ERROR_CODES', () => {
  test('distinguishes guard rejection from runtime script failure', () => {
    expect(TOOL_ERROR_CODES.SCRIPT_REJECTED).toBe('SCRIPT_REJECTED')
    expect(TOOL_ERROR_CODES.SCRIPT_ERROR).toBe('SCRIPT_ERROR')
    expect(TOOL_ERROR_CODES.SCRIPT_ERROR).not.toBe(TOOL_ERROR_CODES.SCRIPT_REJECTED)
  })
})

describe('params schemas', () => {
  test('navigate requires a valid url', () => {
    expect(navigateParams.safeParse({url: 'https://example.com'}).success).toBe(true)
    expect(navigateParams.safeParse({url: 'not a url'}).success).toBe(false)
    expect(navigateParams.safeParse({}).success).toBe(false)
  })

  test('navigate accepts an optional positive tabId', () => {
    expect(navigateParams.safeParse({url: 'https://example.com', tabId: 3}).success).toBe(true)
    expect(navigateParams.safeParse({url: 'https://example.com', tabId: 0}).success).toBe(false)
    expect(navigateParams.safeParse({url: 'https://example.com', tabId: -1}).success).toBe(false)
  })

  test('click rejects refs outside the e<N> pattern', () => {
    expect(clickParams.safeParse({ref: 'e12'}).success).toBe(true)
    expect(clickParams.safeParse({ref: 'e12-a3f91'}).success).toBe(true) // 带快照 token
    expect(clickParams.safeParse({ref: 'e0'}).success).toBe(false)
    expect(clickParams.safeParse({ref: '012'}).success).toBe(false)
    expect(clickParams.safeParse({ref: 'x1'}).success).toBe(false)
    expect(clickParams.safeParse({ref: 'e1-A3F91'}).success).toBe(false) // token 只允许小写字母数字
    expect(clickParams.safeParse({}).success).toBe(false)
  })

  test('click_at requires finite coords and the coordinates:true intent flag', () => {
    expect(clickAtParams.safeParse({x: 100, y: 20, coordinates: true}).success).toBe(true)
    expect(clickAtParams.safeParse({x: 100, y: 20}).success).toBe(false)
    expect(clickAtParams.safeParse({x: 100, y: 20, coordinates: false}).success).toBe(false)
    expect(clickAtParams.safeParse({x: Number.NaN, y: 20, coordinates: true}).success).toBe(false)
    expect(clickAtParams.safeParse({x: 100, y: Number.POSITIVE_INFINITY, coordinates: true}).success).toBe(false)
  })

  test('type bounds text length and keeps submit optional', () => {
    expect(typeParams.safeParse({ref: 'e1', text: 'hello'}).success).toBe(true)
    expect(typeParams.safeParse({ref: 'e1', text: 'hi', submit: true}).success).toBe(true)
    expect(typeParams.safeParse({ref: 'e1', text: ''}).success).toBe(false)
    expect(typeParams.safeParse({ref: 'e1', text: 'x'.repeat(10_001)}).success).toBe(false)
    expect(typeParams.safeParse({ref: 'e1', text: 'x'.repeat(10_000)}).success).toBe(true)
  })

  test('type accepts the new optional editing params and stays back-compat', () => {
    // 老调用方式原样有效
    expect(typeParams.safeParse({ref: 'e1', text: 'hello', submit: true}).success).toBe(true)
    // 新参数：mode / clear / focus
    expect(typeParams.safeParse({ref: 'e1', text: 'x', mode: 'verbatim'}).success).toBe(true)
    expect(typeParams.safeParse({ref: 'e1', text: 'x', mode: 'insert', clear: true}).success).toBe(true)
    expect(typeParams.safeParse({ref: 'e1', text: 'x', focus: 'none'}).success).toBe(true)
    expect(typeParams.safeParse({ref: 'e1', text: 'x', focus: 'click-ref'}).success).toBe(true)
    // focus:none 时 ref 可省；否则非法 mode/focus 拒绝
    expect(typeParams.safeParse({text: 'x', focus: 'none'}).success).toBe(true)
    expect(typeParams.safeParse({ref: 'e1', text: 'x', mode: 'fancy'}).success).toBe(false)
    expect(typeParams.safeParse({ref: 'e1', text: 'x', focus: 'teleport'}).success).toBe(false)
  })

  test('press_key requires a key and validates modifiers', () => {
    expect(pressKeyParams.safeParse({key: 'Enter'}).success).toBe(true)
    expect(pressKeyParams.safeParse({key: 'a', modifiers: ['ctrl']}).success).toBe(true)
    expect(pressKeyParams.safeParse({key: 'Backspace', modifiers: ['ctrl', 'shift'], ref: 'e3'}).success).toBe(true)
    expect(pressKeyParams.safeParse({}).success).toBe(false)
    expect(pressKeyParams.safeParse({key: 'a', modifiers: ['hyper']}).success).toBe(false)
    expect(pressKeyParams.safeParse({key: 'a', ref: 'nope'}).success).toBe(false)
  })

  test('click_at accepts button/clickCount/modifiers and keeps old shape working', () => {
    expect(clickAtParams.safeParse({x: 1, y: 2, coordinates: true}).success).toBe(true)
    expect(clickAtParams.safeParse({x: 1, y: 2, coordinates: true, button: 'right'}).success).toBe(true)
    expect(clickAtParams.safeParse({x: 1, y: 2, coordinates: true, button: 'middle', clickCount: 2}).success).toBe(true)
    expect(clickAtParams.safeParse({x: 1, y: 2, coordinates: true, clickCount: 2, modifiers: ['ctrl']}).success).toBe(true)
    expect(clickAtParams.safeParse({x: 1, y: 2, coordinates: true, button: 'side'}).success).toBe(false)
    expect(clickAtParams.safeParse({x: 1, y: 2, coordinates: true, clickCount: 4}).success).toBe(false)
  })

  test('snapshot accepts query/rootRef/limit filters', () => {
    expect(snapshotParams.safeParse({}).success).toBe(true)
    expect(snapshotParams.safeParse({query: 'code editor'}).success).toBe(true)
    expect(snapshotParams.safeParse({rootRef: 'e12'}).success).toBe(true)
    expect(snapshotParams.safeParse({limit: 5000}).success).toBe(true)
    expect(snapshotParams.safeParse({query: 'x', rootRef: 'e1', limit: 100}).success).toBe(true)
    expect(snapshotParams.safeParse({rootRef: 'x1'}).success).toBe(false)
    expect(snapshotParams.safeParse({limit: 0}).success).toBe(false)
    expect(snapshotParams.safeParse({query: ''}).success).toBe(false)
  })

  test('navigate accepts waitUntil strategy', () => {
    expect(navigateParams.safeParse({url: 'https://example.com', waitUntil: 'networkidle'}).success).toBe(true)
    expect(navigateParams.safeParse({url: 'https://example.com', waitUntil: 'load'}).success).toBe(true)
    expect(navigateParams.safeParse({url: 'https://example.com', waitUntil: 'forever'}).success).toBe(false)
  })

  test('get_text validates ref and result shape', () => {
    expect(getTextParams.safeParse({ref: 'e4'}).success).toBe(true)
    expect(getTextParams.safeParse({ref: 'e4', tabId: 2}).success).toBe(true)
    expect(getTextParams.safeParse({}).success).toBe(false)
    expect(getTextResult.safeParse({text: 'hello', truncated: false}).success).toBe(true)
    expect(getTextResult.safeParse({text: 'hello'}).success).toBe(false)
  })

  test('takeover_tab requires a positive tabId', () => {
    expect(takeoverTabParams.safeParse({tabId: 5}).success).toBe(true)
    expect(takeoverTabParams.safeParse({}).success).toBe(false)
  })

  test('scroll validates direction and caps amount', () => {
    expect(scrollParams.safeParse({direction: 'down'}).success).toBe(true)
    expect(scrollParams.safeParse({direction: 'sideways'}).success).toBe(false)
    expect(scrollParams.safeParse({direction: 'up', amount: 5000}).success).toBe(true)
    expect(scrollParams.safeParse({direction: 'up', amount: 5001}).success).toBe(false)
    expect(scrollParams.safeParse({direction: 'up', amount: 0}).success).toBe(false)
  })

  test('tabSelect requires a tabId', () => {
    expect(tabSelectParams.safeParse({tabId: 7}).success).toBe(true)
    expect(tabSelectParams.safeParse({}).success).toBe(false)
  })
})

describe('result schemas', () => {
  test('snapshotResult accepts a well-formed payload and rejects missing fields', () => {
    const ok = {
      snapshot: '- document "t"',
      version: 3,
      url: 'https://example.com',
      truncated: false,
    }
    expect(snapshotResult.safeParse(ok).success).toBe(true)
    expect(snapshotResult.safeParse({...ok, truncated: 'no'}).success).toBe(false)
    const partial = {snapshot: ok.snapshot, version: ok.version, truncated: ok.truncated}
    expect(snapshotResult.safeParse(partial).success).toBe(false)
  })
})

describe('P3 schemas', () => {
  test('wait requires exactly one condition', () => {
    expect(waitParams.safeParse({text: 'hello'}).success).toBe(true)
    expect(waitParams.safeParse({selector: '#x'}).success).toBe(true)
    expect(waitParams.safeParse({urlContains: '/docs'}).success).toBe(true)
    expect(waitParams.safeParse({editorRendered: true}).success).toBe(true)
    expect(waitParams.safeParse({}).success).toBe(false)
    expect(waitParams.safeParse({text: 'a', selector: '#x'}).success).toBe(false)
    expect(waitParams.safeParse({text: ''}).success).toBe(false)
    expect(waitParams.safeParse({editorRendered: false, text: 'a'}).success).toBe(false)
  })

  test('wait bounds timeoutMs', () => {
    expect(waitParams.safeParse({text: 'x', timeoutMs: 30_000}).success).toBe(true)
    expect(waitParams.safeParse({text: 'x', timeoutMs: 30_001}).success).toBe(false)
    expect(waitParams.safeParse({text: 'x', timeoutMs: 0}).success).toBe(false)
  })

  test('read_console validates level enum', () => {
    expect(readConsoleParams.safeParse({level: 'error'}).success).toBe(true)
    expect(readConsoleParams.safeParse({level: 'verbose'}).success).toBe(false)
  })

  test('read_network bounds limit', () => {
    expect(readNetworkParams.safeParse({limit: 500}).success).toBe(true)
    expect(readNetworkParams.safeParse({limit: 501}).success).toBe(false)
    expect(readNetworkParams.safeParse({limit: 0}).success).toBe(false)
  })

  test('add_allowlist_domain requires a non-empty domain', () => {
    expect(addAllowlistDomainParams.safeParse({domain: 'example.com'}).success).toBe(true)
    expect(addAllowlistDomainParams.safeParse({domain: ''}).success).toBe(false)
  })
})
