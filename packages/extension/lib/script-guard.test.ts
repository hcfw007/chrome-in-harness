import {describe, expect, test} from 'vitest'
import {guardScript} from './script-guard.js'

describe('guardScript — happy path', () => {
  test('accepts plain expressions', () => {
    expect(guardScript('document.title', false)).toEqual({ok: true, expression: 'document.title'})
    expect(guardScript('document.querySelector("h1")?.innerText', false).ok).toBe(true)
    expect(guardScript('document.body?.innerText.slice(0, 100)', false).ok).toBe(true)
  })

  test('accepts simple arrow IIFEs', () => {
    expect(guardScript('(() => document.title)()', false).ok).toBe(true)
    expect(guardScript('(async () => { return document.title })()', false).ok).toBe(true)
  })

  test('accepts object/array literals as expressions', () => {
    expect(guardScript('({a: 1, b: 2})', false).ok).toBe(true)
    expect(guardScript('[1, 2, 3]', false).ok).toBe(true)
  })

  test('awaitPromise requires an async IIFE', () => {
    expect(guardScript('(async () => { return await Promise.resolve(1) })()', true).ok).toBe(true)
    expect(guardScript('document.title', true).ok).toBe(false)
  })
})

describe('guardScript — forbidden patterns', () => {
  const cases: Array<[string, string]> = [
    ['fetch("/api")', 'fetch'],
    ['new XMLHttpRequest()', 'XMLHttpRequest'],
    ['new WebSocket("ws://x")', 'WebSocket'],
    ['navigator.sendBeacon("/x")', 'sendBeacon'],
    ['eval("1+1")', 'eval'],
    ['new Function("return 1")', 'Function constructor'],
    ['document.write("<b>")', 'document.write'],
    ['location.href = "https://x"', 'location assignment'],
    ['window.open("https://x")', 'window.open'],
    ['chrome.storage.local.get()', 'chrome.*'],
    ['debugger;', 'debugger statement'],
  ]

  for (const [expression, label] of cases) {
    test(`rejects ${label}`, () => {
      const result = guardScript(expression, false)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.reason.length).toBeGreaterThan(0)
    })
  }
})

describe('guardScript — size & shape', () => {
  test('rejects empty expression', () => {
    expect(guardScript('', false).ok).toBe(false)
  })

  test('rejects over-long expressions', () => {
    expect(guardScript('a'.repeat(8_001), false).ok).toBe(false)
  })

  test('rejects expressions that start with a non-expression token', () => {
    expect(guardScript('; alert(1)', false).ok).toBe(false)
    expect(guardScript('// comment', false).ok).toBe(false)
  })
})
