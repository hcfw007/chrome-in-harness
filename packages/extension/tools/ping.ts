export interface PingResult {
  readonly version: string
  readonly userAgent: string
  /** 本次 service worker 启动时间：reload_extension 前后对比，确认新代码已加载。 */
  readonly startedAt: number
}

const STARTED_AT = Date.now()

export async function ping(_params: unknown): Promise<PingResult> {
  return {
    version: chrome.runtime.getManifest().version,
    userAgent: navigator.userAgent,
    startedAt: STARTED_AT,
  }
}
