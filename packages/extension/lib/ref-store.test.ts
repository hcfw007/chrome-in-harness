import {describe, expect, test} from 'vitest'
import {RefStore, parseRef, splitToken} from './ref-store.js'
import type {RefEntry} from './ref-store.js'

function entry(ref: string, backendDOMNodeId = 1): RefEntry {
  return {ref, backendDOMNodeId, role: 'button', name: `el-${ref}`}
}

/** vN → token：代 'a1b2' 固定，版本 base36。 */
const tokenOf = (v: number): string => `a1b2${v.toString(36)}`
const refOf = (n: number, v: number): string => `e${n}-${tokenOf(v)}`

function storeAt(store: RefStore, tabId: number, version: number, refs: readonly RefEntry[]): void {
  store.store(tabId, 'https://a.com', tokenOf(version), refs, version)
}

describe('parseRef / splitToken', () => {
  test('splits num and token; bare refs have no token', () => {
    expect(parseRef('e3-a7k22')).toEqual({num: 'e3', token: 'a7k22'})
    expect(parseRef('e12')).toEqual({num: 'e12', token: undefined})
    expect(splitToken('a7k22')).toEqual({gen: 'a7k2', ver: '2'})
  })
})

describe('RefStore（token 语义）', () => {
  test('同快照 token 匹配 → ok；同代旧快照 → superseded；跨代 → era', () => {
    const store = new RefStore()
    storeAt(store, 1, 1, [entry(refOf(1, 1)), entry(refOf(2, 1), 2)])
    expect(store.resolve(1, refOf(1, 1))).toEqual({
      kind: 'ok',
      entry: {ref: refOf(1, 1), backendDOMNodeId: 1, role: 'button', name: `el-${refOf(1, 1)}`},
    })

    // 快照更替（同 worker 代，版本 2 的 token 不同）
    storeAt(store, 1, 2, [entry(refOf(1, 2), 9)])
    const stale = store.resolve(1, refOf(1, 1))
    expect(stale.kind).toBe('stale_ref')
    expect(stale.kind === 'stale_ref' && stale.reason).toBe('superseded')

    // 跨 worker 代：token 前 4 位不同
    const store2 = new RefStore()
    store2.store(1, 'https://a.com', 'ffff1', [entry('e1-ffff1')], 1)
    const era = store2.resolve(1, refOf(1, 1))
    expect(era.kind).toBe('stale_ref')
    expect(era.kind === 'stale_ref' && era.reason).toBe('era')
  })

  test('裸 ref（无 token）显式拒绝为 legacy，绝不静默匹配', () => {
    const store = new RefStore()
    storeAt(store, 1, 1, [entry(refOf(1, 1))])
    const result = store.resolve(1, 'e1')
    expect(result.kind).toBe('stale_ref')
    expect(result.kind === 'stale_ref' && result.reason).toBe('legacy')
  })

  test('no_snapshot 与版本/token 查询', () => {
    const store = new RefStore()
    expect(store.resolve(1, refOf(1, 1))).toEqual({kind: 'no_snapshot'})
    expect(store.version(1)).toBe(0)
    expect(store.token(1)).toBeUndefined()
    storeAt(store, 1, 7, [entry(refOf(1, 7))])
    expect(store.version(1)).toBe(7)
    expect(store.token(1)).toBe(tokenOf(7))
    store.invalidate(1)
    expect(store.has(1)).toBe(false)
    expect(store.resolve(1, refOf(1, 7))).toEqual({kind: 'no_snapshot'})
  })

  test('nextVersion 严格大于一切已用版本（导航 invalidate / SW 重启都不复用）', () => {
    const store = new RefStore()
    expect(store.nextVersion(1, 0)).toBe(1)
    storeAt(store, 1, 1, [entry(refOf(1, 1))])
    expect(store.nextVersion(1, 0)).toBe(2)
    // 导航 invalidate：内存清零，但水位线（最近已用）=1 → 下一个必须 ≥2
    store.invalidate(1)
    expect(store.nextVersion(1, 1)).toBe(2)
    storeAt(store, 1, 2, [entry(refOf(1, 2))])
    expect(store.nextVersion(1, 2)).toBe(3)
    // SW 重启：水位线（最近已用）=7 → 从 8 继续，绝不复用 7
    storeAt(store, 1, 7, [entry(refOf(1, 7))])
    store.invalidate(1)
    expect(store.nextVersion(1, 7)).toBe(8)
    // 内存版本更高时不回退
    storeAt(store, 1, 9, [entry(refOf(1, 9))])
    expect(store.nextVersion(1, 7)).toBe(10)
  })

  test('lookupHistorical 在最近 3 层历史里查找（过滤快照不再挤掉真实历史）', () => {
    const store = new RefStore()
    storeAt(store, 1, 1, [{...entry(refOf(5, 1), 55), role: 'textbox', name: 'Code editor'}])
    storeAt(store, 1, 2, [entry(refOf(1, 2))])
    expect(store.resolve(1, refOf(5, 1)).kind).toBe('stale_ref')
    expect(store.lookupHistorical(1, refOf(5, 1))).toMatchObject({
      version: 1,
      entry: {backendDOMNodeId: 55, role: 'textbox', name: 'Code editor'},
    })
    // 再覆盖两次仍在 3 层窗口内（历史 = [v1, v2, v3]）
    storeAt(store, 1, 3, [entry(refOf(2, 3))])
    expect(store.lookupHistorical(1, refOf(5, 1))).toBeDefined()
    storeAt(store, 1, 4, [entry(refOf(3, 4))])
    expect(store.lookupHistorical(1, refOf(5, 1))).toBeDefined()
    // 第 5 次覆盖后，历史 = [v2, v3, v4]，v1 被挤出窗口
    storeAt(store, 1, 5, [entry(refOf(4, 5))])
    expect(store.lookupHistorical(1, refOf(5, 1))).toBeUndefined()
  })

  test('invalidate 清历史层；entries 列当前 ref', () => {
    const store = new RefStore()
    storeAt(store, 1, 1, [entry(refOf(1, 1))])
    storeAt(store, 1, 2, [entry(refOf(2, 2), 2)])
    expect(store.entries(1).map((e) => e.ref)).toEqual([refOf(2, 2)])
    store.invalidate(1)
    expect(store.lookupHistorical(1, refOf(1, 1))).toBeUndefined()
    expect(store.entries(1)).toEqual([])
  })

  test('tab 之间互相隔离', () => {
    const store = new RefStore()
    storeAt(store, 1, 1, [entry(refOf(1, 1))])
    storeAt(store, 2, 5, [entry(refOf(1, 5), 5)])
    expect(store.resolve(1, refOf(1, 5)).kind).toBe('stale_ref')
    expect(store.resolve(2, refOf(1, 5)).kind).toBe('ok')
  })
})
