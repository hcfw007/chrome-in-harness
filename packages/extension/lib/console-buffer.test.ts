import {describe, expect, test} from 'vitest'
import {ConsoleBuffer} from './console-buffer.js'
import type {ConsoleEntry} from './console-buffer.js'
import {NetworkBuffer} from './network-buffer.js'

function entry(level: ConsoleEntry['level'], text: string, timestamp: number): ConsoleEntry {
  return {level, text, timestamp}
}

describe('ConsoleBuffer', () => {
  test('append and read in chronological order', () => {
    const buf = new ConsoleBuffer()
    buf.append(1, entry('info', 'a', 1))
    buf.append(1, entry('error', 'b', 2))
    buf.append(1, entry('warning', 'c', 3))
    expect(buf.read(1, 'all').map((e) => e.text)).toEqual(['a', 'b', 'c'])
    expect(buf.read(1, 'error').map((e) => e.text)).toEqual(['b'])
    expect(buf.read(1, 'warning').map((e) => e.text)).toEqual(['c'])
  })

  test('wraps around at capacity, dropping oldest', () => {
    const buf = new ConsoleBuffer(3)
    for (let i = 1; i <= 5; i += 1) {
      buf.append(1, entry('info', `m${i}`, i))
    }
    expect(buf.read(1, 'all').map((e) => e.text)).toEqual(['m3', 'm4', 'm5'])
  })

  test('tabs are isolated and clear drops only one tab', () => {
    const buf = new ConsoleBuffer()
    buf.append(1, entry('info', 'x', 1))
    buf.append(2, entry('info', 'y', 1))
    buf.clear(1)
    expect(buf.read(1, 'all')).toEqual([])
    expect(buf.read(2, 'all').map((e) => e.text)).toEqual(['y'])
  })
})

describe('NetworkBuffer', () => {
  test('merges request, response and failure by requestId', () => {
    const buf = new NetworkBuffer()
    buf.recordRequest(1, 'r1', 'GET', 'https://a.com/x', 10)
    buf.recordRequest(1, 'r2', 'POST', 'https://a.com/y', 20)
    buf.recordResponse(1, 'r1', 200, 'application/json')
    buf.recordFailure(1, 'r2', 'net::ERR_ABORTED')
    const rows = buf.read(1)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({method: 'POST', url: 'https://a.com/y', error: 'net::ERR_ABORTED'})
    expect(rows[1]).toMatchObject({method: 'GET', status: 200, mimeType: 'application/json'})
  })

  test('read filters by url substring, newest first, respects limit', () => {
    const buf = new NetworkBuffer()
    for (let i = 1; i <= 6; i += 1) {
      buf.recordRequest(1, `r${i}`, 'GET', `https://cdn.example.com/asset${i}`, i)
    }
    buf.recordRequest(1, 'doc', 'GET', 'https://example.com/', 0)
    expect(buf.read(1, undefined, 100).map((e) => e.url)).toEqual([
      'https://cdn.example.com/asset6',
      'https://cdn.example.com/asset5',
      'https://cdn.example.com/asset4',
      'https://cdn.example.com/asset3',
      'https://cdn.example.com/asset2',
      'https://cdn.example.com/asset1',
      'https://example.com/',
    ])
    expect(buf.read(1, 'cdn', 3)).toHaveLength(3)
    // substring 语义：cdn.example.com 同样命中 example.com
    expect(buf.read(1, 'example.com')).toHaveLength(7)
    expect(buf.read(1, 'https://example').map((e) => e.url)).toEqual(['https://example.com/'])
  })

  test('skips data: URLs entirely', () => {
    const buf = new NetworkBuffer()
    buf.recordRequest(1, 'img', 'GET', 'data:image/png;base64,AAAA', 1)
    buf.recordResponse(1, 'img', 200, 'image/png', 1.1)
    expect(buf.read(1)).toEqual([])
  })

  test('computes duration from CDP second timestamps', () => {
    const buf = new NetworkBuffer()
    buf.recordRequest(1, 'r1', 'GET', 'https://a.com/x', 100.0)
    buf.recordResponse(1, 'r1', 200, 'application/json', 100.25)
    buf.recordRequest(1, 'r2', 'GET', 'https://a.com/y', 100.0)
    buf.recordFailure(1, 'r2', 'canceled', 100.5)
    buf.recordRequest(1, 'r3', 'GET', 'https://a.com/z', 100.0)
    buf.recordResponse(1, 'r3', 200, undefined)
    const byUrl = new Map(buf.read(1).map((e) => [e.url, e.durationMs]))
    expect(byUrl.get('https://a.com/x')).toBe(250)
    expect(byUrl.get('https://a.com/y')).toBe(500)
    expect(byUrl.get('https://a.com/z')).toBeUndefined()
  })

  test('findCompleted honors since / method / status and ignores pending requests', () => {
    let clock = 1_000
    const buf = new NetworkBuffer(500, () => clock)
    buf.recordRequest(1, 'old', 'POST', 'https://a.com/api/sync', 1)
    buf.recordResponse(1, 'old', 200, 'application/json', 1.1)
    clock = 5_000
    buf.recordRequest(1, 'pending', 'POST', 'https://a.com/api/sync', 2)
    buf.recordRequest(1, 'get', 'GET', 'https://a.com/api/sync', 3)
    buf.recordResponse(1, 'get', 200, 'application/json', 3.1)
    buf.recordRequest(1, 'err', 'POST', 'https://a.com/api/sync', 4)
    buf.recordResponse(1, 'err', 500, 'application/json', 4.1)

    expect(buf.findCompleted(1, {urlContains: '/api/sync', since: 4_000})?.method).toBe('GET')
    expect(buf.findCompleted(1, {urlContains: '/api/sync', method: 'post', since: 4_000})?.status).toBe(500)
    expect(buf.findCompleted(1, {urlContains: '/api/sync', method: 'POST', status: 200, since: 4_000})).toBeUndefined()
    expect(buf.findCompleted(1, {urlContains: '/api/sync', method: 'POST', status: 200, since: 0})?.status).toBe(200)
  })

  test('wraps at capacity and clears per tab', () => {
    const buf = new NetworkBuffer(3)
    for (let i = 1; i <= 5; i += 1) {
      buf.recordRequest(1, `r${i}`, 'GET', `https://a.com/${i}`, i)
    }
    expect(buf.read(1, undefined, 100)).toHaveLength(3)
    buf.clear(1)
    expect(buf.read(1)).toEqual([])
  })
})
