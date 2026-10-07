/**
 * worker 代标识：SW 每次启动生成一次（4 位 hex），快照 token 编码它。
 * ref 里的 token 与当前代不一致 → 显式 STALE_REF（跨重启的 ref 不得静默复用）。
 */

import {WORKER_GEN_CHARS} from './ref-store'

let era = ''

/** 当前 worker 代（4 位 hex）；进程内幂等。 */
export function workerEra(): string {
  if (era === '') {
    const buf = new Uint8Array(WORKER_GEN_CHARS / 2)
    crypto.getRandomValues(buf)
    era = Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('')
  }
  return era
}

/** 版本号 → token 尾部（base36，小写）。 */
export function versionSuffix(version: number): string {
  return version.toString(36)
}

/** 组装快照 token：worker 代 + 版本，如 'a3f9' + 'c' → 'a3f9c'。 */
export function snapshotToken(version: number): string {
  return `${workerEra()}${versionSuffix(version)}`
}
