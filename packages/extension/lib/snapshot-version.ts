/**
 * 快照版本水位线：chrome.storage.session 按 tab 持久化「最近已用版本号」。
 * 下一次快照取 max(内存版本, 水位线) + 1——SW 空闲回收（session storage 存活）
 * 与导航 invalidate 后版本都严格递增，同 token 绝不跨快照复用。
 * 扩展重载/浏览器关闭会清 session storage：token 里的 worker 代随之更换，
 * 旧 ref 仍会被显式拒绝，不依赖版本号判断新旧。
 */

const FLOOR_KEY = 'snapshot.version.floor.v1'

type FloorMap = Record<string, number>

const cache = new Map<number, number>()

function hasSessionStorage(): boolean {
  return typeof chrome !== 'undefined' && chrome.storage?.session !== undefined
}

async function readFloors(): Promise<FloorMap> {
  const bag = await chrome.storage.session.get(FLOOR_KEY)
  const raw: unknown = bag[FLOOR_KEY]
  return typeof raw === 'object' && raw !== null ? (raw as FloorMap) : {}
}

/** 取某 tab 的版本下限；存储不可用/无记录返回 0。 */
export async function versionFloor(tabId: number): Promise<number> {
  const cached = cache.get(tabId)
  if (cached !== undefined) return cached
  if (!hasSessionStorage()) return 0
  try {
    const floors = await readFloors()
    const value = floors[String(tabId)]
    if (typeof value === 'number' && value > 0) {
      cache.set(tabId, value)
      return value
    }
  } catch (error) {
    console.warn('[snapshot-version] read failed:', error instanceof Error ? error.message : error)
  }
  return 0
}

/** 快照落库后更新水位线（只前进不后退）。失败仅告警——水位线只是防回退的尽力而为。 */
export async function saveVersionFloor(tabId: number, version: number): Promise<void> {
  const current = cache.get(tabId) ?? 0
  if (version <= current) return
  cache.set(tabId, version)
  if (!hasSessionStorage()) return
  try {
    const floors = await readFloors()
    floors[String(tabId)] = Math.max(floors[String(tabId)] ?? 0, version)
    await chrome.storage.session.set({[FLOOR_KEY]: floors})
  } catch (error) {
    console.warn('[snapshot-version] save failed:', error instanceof Error ? error.message : error)
  }
}

/** 清掉某 tab 的水位线缓存（tab 关闭时；session storage 里的残留会被下次覆盖）。 */
export function forgetVersionFloor(tabId: number): void {
  cache.delete(tabId)
}
