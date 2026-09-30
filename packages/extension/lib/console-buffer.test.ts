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
