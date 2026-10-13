import {addAllowlistDomain} from './allowlist'
import {runActions} from './batch'
import {readConsole, readNetwork} from './debug'
import {evaluateScript} from './evaluate'
import {getText} from './get-text'
import {click, clickAt, hover, pressKey, scroll, typeText} from './interact'
import {ping} from './ping'
import {invoke, register} from './registry'
import {requestPermission} from './request-permission'
import {screenshot} from './screenshot'
import {navigate, snapshot} from './snapshot'
import {ensureTab, tabClose, tabList, tabNew, tabSelect, takeoverTab} from './tabs'
import {wait} from './wait'

export {register}

export const dispatch = invoke

/** 新工具以后往这里加 register。 */
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
register('ensure_tab', ensureTab)
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
register('run_actions', runActions)
