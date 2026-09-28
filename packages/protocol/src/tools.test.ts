import {describe, expect, test} from 'vitest'
import {
  clickParams,
  navigateParams,
  scrollParams,
  snapshotResult,
  tabSelectParams,
  typeParams,
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
