export interface PingResult {
  readonly version: string;
  readonly userAgent: string;
}

export async function ping(_params: unknown): Promise<PingResult> {
  return {
    version: chrome.runtime.getManifest().version,
    userAgent: navigator.userAgent,
  };
}
