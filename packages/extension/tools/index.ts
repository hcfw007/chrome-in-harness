import {setGroupsState} from '../lib/tab-group'
import {addAllowlistDomain} from './allowlist'
import {readConsole, readNetwork} from './debug'
import {evaluateScript} from './evaluate'
import {getText} from './get-text'
import {click, clickAt, hover, pressKey, scroll, typeText} from './interact'
import {ping} from './ping'
import {requestPermission} from './request-permission'
import {screenshot} from './screenshot'
import {navigate, snapshot} from './snapshot'
import {tabClose, tabList, tabNew, tabSelect, takeoverTab} from './tabs'
import type {ToolHandler} from './types'
import {wait} from './wait'

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
register('click_at', clickAt)
register('hover', hover)
register('type', typeText)
register('press_key', pressKey)
register('scroll', scroll)
register('screenshot', screenshot)
register('tab_list', tabList)
register('tab_new', tabNew)
register('tab_select', tabSelect)
register('tab_close', tabClose)
register('takeover_tab', takeoverTab)
register('read_console', readConsole)
register('read_network', readNetwork)
register('wait', wait)
register('add_allowlist_domain', addAllowlistDomain)
register('evaluate_script', evaluateScript)
register('request_permission', requestPermission)
register('get_text', getText)
