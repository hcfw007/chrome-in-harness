import {click, hover, scroll, typeText} from './interact'
import {ping} from './ping'
import {screenshot} from './screenshot'
import {navigate, snapshot} from './snapshot'
import {tabClose, tabList, tabNew, tabSelect} from './tabs'
import {setGroupsState} from '../lib/tab-group'
import type {ToolHandler} from './types'

const registry = new Map<string, ToolHandler>()

/** 新工具以后往这里加 register。 */
export function register(name: string, handler: ToolHandler): void {
  if (registry.has(name)) {
    throw new Error(`Tool "${name}" is already registered`)
  }
  registry.set(name, handler)
}

export async function dispatch(name: string, params: unknown): Promise<unknown> {
  const handler = registry.get(name)
  if (handler === undefined) {
    throw new Error(`Unknown tool "${name}"`)
  }
  if (name === 'ping') return handler(params)
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

register('ping', ping)
register('navigate', navigate)
register('snapshot', snapshot)
register('click', click)
register('hover', hover)
register('type', typeText)
register('scroll', scroll)
register('screenshot', screenshot)
register('tab_list', tabList)
register('tab_new', tabNew)
register('tab_select', tabSelect)
register('tab_close', tabClose)
