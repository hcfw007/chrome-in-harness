import {describe, expect, test} from 'vitest'
import {RefStore} from './ref-store.js'
import type {RefEntry} from './ref-store.js'

function entry(ref: string, backendDOMNodeId = 1): RefEntry {
  return {ref, backendDOMNodeId, role: 'button', name: `el-${ref}`}
}

describe('RefStore', () => {
  test('store bumps the version per tab and resolve returns the entry', () => {
    const store = new RefStore()
    expect(store.store(1, 'https://a.com', [entry('e1'), entry('e2', 2)])).toBe(1)
    expect(store.store(1, 'https://a.com', [entry('e3', 3)])).toBe(2)
    expect(store.store(2, 'https://b.com', [entry('e1', 9)])).toBe(1)

    expect(store.resolve(1, 'e3')).toEqual({
      kind: 'ok',
      entry: {ref: 'e3', backendDOMNodeId: 3, role: 'button', name: 'el-e3'},
    })
    // 新快照覆盖后，旧 ref 变 stale
    expect(store.resolve(1, 'e1')).toEqual({kind: 'stale_ref'})
    // tab 之间互相隔离
    expect(store.resolve(2, 'e3')).toEqual({kind: 'stale_ref'})
  })

  test('resolve distinguishes no_snapshot from stale_ref', () => {
    const store = new RefStore()
    expect(store.resolve(1, 'e1')).toEqual({kind: 'no_snapshot'})
    store.store(1, 'https://a.com', [entry('e1')])
    expect(store.resolve(1, 'e999')).toEqual({kind: 'stale_ref'})
  })

  test('invalidate drops the whole tab snapshot', () => {
    const store = new RefStore()
    store.store(1, 'https://a.com', [entry('e1')])
    store.invalidate(1)
    expect(store.has(1)).toBe(false)
    expect(store.resolve(1, 'e1')).toEqual({kind: 'no_snapshot'})
    expect(store.version(1)).toBe(0)
  })

  test('invalidate on one tab leaves others intact', () => {
    const store = new RefStore()
    store.store(1, 'https://a.com', [entry('e1')])
    store.store(2, 'https://b.com', [entry('e1', 5)])
    store.invalidate(1)
    expect(store.resolve(2, 'e1').kind).toBe('ok')
  })

  test('clear wipes every tab', () => {
    const store = new RefStore()
    store.store(1, 'https://a.com', [entry('e1')])
    store.store(2, 'https://b.com', [entry('e1', 5)])
    store.clear()
    expect(store.version(1)).toBe(0)
    expect(store.version(2)).toBe(0)
  })
})
