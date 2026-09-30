import {describe, expect, test} from 'vitest'
import {
  addAllowlistDomainParams,
  clickAtParams,
  clickParams,
  navigateParams,
  readConsoleParams,
  readNetworkParams,
  scrollParams,
  snapshotResult,
  tabSelectParams,
  typeParams,
  waitParams,
} from './tools.js'

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
    expect(clickParams.safeParse({ref: 'e0'}).success).toBe(false)
    expect(clickParams.safeParse({ref: '012'}).success).toBe(false)
    expect(clickParams.safeParse({ref: 'x1'}).success).toBe(false)
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
    expect(waitParams.safeParse({}).success).toBe(false)
    expect(waitParams.safeParse({text: 'a', selector: '#x'}).success).toBe(false)
    expect(waitParams.safeParse({text: ''}).success).toBe(false)
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
