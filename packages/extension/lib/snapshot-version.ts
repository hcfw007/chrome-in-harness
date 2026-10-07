/**
 * 快照版本水位线：chrome.storage.session 按 tab 持久化最近一次快照版本号。
 * SW 被杀后内存里的 RefStore 归零，下次 snapshot 从水位线 +1 继续，
 * 保证调用方看到的版本号单调递增、可比较新旧。
 * session storage 在浏览器关闭时清空（版本回退到 1 也无害：那时全部调用方也重启了）。
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
