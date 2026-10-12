/** 全域访问单独存储，默认关闭；只能在扩展选项页经用户风险确认后开启。 */
const ALL_DOMAINS_STORAGE_KEY = 'allowAllDomains.v1'

export async function getAllDomainsAllowed(): Promise<boolean> {
  const bag = await chrome.storage.local.get(ALL_DOMAINS_STORAGE_KEY)
  return bag[ALL_DOMAINS_STORAGE_KEY] === true
}

export async function setAllDomainsAllowed(enabled: boolean): Promise<void> {
  await chrome.storage.local.set({[ALL_DOMAINS_STORAGE_KEY]: enabled})
}

/** 返回实际保存的开关状态。取消不写入，关闭不需要风险确认。 */
export async function confirmAllDomainsAccess(enabled: boolean, confirm: (message: string) => boolean | Promise<boolean>): Promise<boolean> {
  if (enabled && !await confirm(
    '允许所有域名后，AI 可操作受管标签组内的所有 HTTP/HTTPS 网站，使用你的真实登录状态，读取敏感内容或提交真实数据。\n\n仅建议在专用测试浏览器配置和测试账号中开启。原白名单将保留，关闭后恢复生效。\n\n确定开启吗？',
  )) return getAllDomainsAllowed()
  await setAllDomainsAllowed(enabled)
  return enabled
}
