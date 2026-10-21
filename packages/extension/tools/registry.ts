/**
 * 工具注册表：名称 → handler 的唯一真源。
 * `dispatch`（WS 入口）与批量执行 `invoke` 共用同一条调用/状态路径，
 * 保证批量步骤与单独调用在鉴权、组状态标记上完全一致。
 */
import {setGroupsState} from '../lib/tab-group'

import type {ToolHandler} from './types'

const registry = new Map<string, ToolHandler>()

export function register(name: string, handler: ToolHandler): void {
  if (registry.has(name)) {
    throw new Error(`Tool "${name}" is already registered`)
  }
  registry.set(name, handler)
}

/** 统一调用路径：查表 → 组状态 busy → handler → done/error。ping 不计状态。 */
export async function invoke(name: string, params: unknown): Promise<unknown> {
  const handler = registry.get(name)
  if (handler === undefined) {
    throw new Error(`Unknown tool "${name}"`)
  }
  // ping 不计状态；reload_extension 会杀掉 SW，标 busy 后没人能复位
  if (name === 'ping' || name === 'reload_extension') return handler(params)
  await setGroupsState('busy')
  try {
    const result = await handler(params)
    void setGroupsState('done')
    return result
  } catch (error) {
    void setGroupsState('error')
    throw error
  }
}
