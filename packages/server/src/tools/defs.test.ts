import {describe, expect, test} from 'vitest'
import {BROWSER_TOOL_DEFS} from './defs-browser.js'
import {DEBUG_TOOL_DEFS} from './defs-debug.js'
import {EVALUATE_TOOL_DEFS} from './defs-evaluate.js'
import {TAB_TOOL_DEFS} from './defs-tabs.js'
import type {BridgeCall, ToolDef} from './types.js'

function fakeBridge(result: unknown | Error): {call: BridgeCall; received: Array<{tool: string; params: unknown}>} {
  const received: Array<{tool: string; params: unknown}> = []
  return {
    received,
    call: async (tool, params) => {
      received.push({tool, params})
      if (result instanceof Error) throw result
      return result
    },
  }
}

async function run(def: ToolDef, args: unknown, call: BridgeCall) {
  return def.run(args, call)
}

const ALL = [...TAB_TOOL_DEFS, ...BROWSER_TOOL_DEFS, ...DEBUG_TOOL_DEFS, ...EVALUATE_TOOL_DEFS]

function byName(name: string): ToolDef {
  const def = ALL.find((d) => d.name === name)
  if (def === undefined) throw new Error(`def not found: ${name}`)
  return def
}

describe('tool name uniqueness', () => {
  test('every tool has a unique name', () => {
    const names = ALL.map((d) => d.name)
    expect(new Set(names).size).toBe(names.length)
  })
})

describe('browser defs', () => {
  test('navigate formats url, title and load flag', async () => {
    const fake = fakeBridge({url: 'https://example.com/', title: 'Example', loaded: true})
    const content = await run(byName('navigate'), {url: 'https://example.com/'}, fake.call)
    expect(content).toEqual([{type: 'text', text: 'Navigated to https://example.com/ — "Example"'}])
    expect(fake.received[0]).toEqual({tool: 'navigate', params: {url: 'https://example.com/'}})
  })

  test('navigate flags a readiness timeout with the default strategy', async () => {
    const fake = fakeBridge({url: 'https://slow.example/', loaded: false})
    const content = await run(byName('navigate'), {url: 'https://slow.example/'}, fake.call)
    expect(content[0]).toMatchObject({type: 'text'})
    expect((content[0] as {text: string}).text).toContain('DOMContentLoaded timed out')
  })

  test('navigate flags a load-event timeout when waitUntil is load', async () => {
    const fake = fakeBridge({url: 'https://slow.example/', loaded: false, waitUntil: 'load'})
    const content = await run(byName('navigate'), {url: 'https://slow.example/', waitUntil: 'load'}, fake.call)
    expect((content[0] as {text: string}).text).toContain('load event timed out')
  })

  test('snapshot prepends header and truncation marker', async () => {
    const fake = fakeBridge({snapshot: '- document "T"', version: 4, url: 'https://e.com', truncated: true})
    const content = await run(byName('snapshot'), {}, fake.call)
    const text = (content[0] as {text: string}).text
    expect(text).toContain('version 4')
    expect(text).toContain('TRUNCATED')
    expect(text).toContain('- document "T"')
  })

  test('click passes params through and confirms', async () => {
    const fake = fakeBridge({})
    const content = await run(byName('click'), {ref: 'e3'}, fake.call)
    expect(fake.received[0]).toEqual({tool: 'click', params: {ref: 'e3'}})
    expect(content).toEqual([{type: 'text', text: 'Clicked e3'}])
  })

  test('click_at forwards coordinates and confirms', async () => {
    const fake = fakeBridge({})
    const content = await run(byName('click_at'), {x: 2466, y: 22, coordinates: true}, fake.call)
    expect(fake.received[0]).toEqual({
      tool: 'click_at',
      params: {x: 2466, y: 22, coordinates: true},
    })
    expect(content).toEqual([{type: 'text', text: 'Clicked at (2466, 22)'}])
  })

  test('screenshot returns MCP image content with the base64 payload', async () => {
    const fake = fakeBridge({data: 'aGVsbG8=', mimeType: 'image/png'})
    const content = await run(byName('screenshot'), {}, fake.call)
    expect(content).toEqual([{type: 'image', data: 'aGVsbG8=', mimeType: 'image/png'}])
  })

  test('extension errors surface as thrown Errors for the unified handler', async () => {
    const fake = fakeBridge(new Error('STALE_REF: ref e1 is stale'))
    await expect(run(byName('click'), {ref: 'e1'}, fake.call)).rejects.toThrow('STALE_REF')
  })

  test('wait rejects zero or multiple conditions before calling the bridge', async () => {
    const fake = fakeBridge({matched: true, timedOut: false})
    await expect(run(byName('wait'), {}, fake.call)).rejects.toThrow('exactly one')
    await expect(
      run(byName('wait'), {text: 'a', selector: '#x'}, fake.call),
    ).rejects.toThrow('exactly one')
    await expect(
      run(byName('wait'), {editorRendered: true, urlContains: '/x'}, fake.call),
    ).rejects.toThrow('exactly one')
    expect(fake.received).toHaveLength(0)
  })

  test('wait forwards editorRendered and renders matched', async () => {
    const fake = fakeBridge({matched: true, timedOut: false})
    const content = await run(byName('wait'), {editorRendered: true}, fake.call)
    expect(fake.received).toEqual([{tool: 'wait', params: {editorRendered: true}}])
    expect(content).toEqual([{type: 'text', text: 'Condition matched.'}])
  })

  test('wait forwards a single condition and renders matched', async () => {
    const fake = fakeBridge({matched: true, timedOut: false})
    const content = await run(byName('wait'), {text: 'hello'}, fake.call)
    expect(fake.received).toEqual([{tool: 'wait', params: {text: 'hello'}}])
    expect(content).toEqual([{type: 'text', text: 'Condition matched.'}])
  })

  test('type forwards mode/clear/focus and confirms with insertion point', async () => {
    const fake = fakeBridge({
      mode: 'verbatim',
      insertedLines: 3,
      insertionPoint: {line: 4, col: 1},
    })
    const content = await run(
      byName('type'),
      {ref: 'e7', text: 'code', mode: 'verbatim', clear: true},
      fake.call,
    )
    expect(fake.received[0]).toEqual({tool: 'type', params: {ref: 'e7', text: 'code', mode: 'verbatim', clear: true}})
    expect(content).toEqual([
      {type: 'text', text: 'Typed into e7 (verbatim, cleared first, 4 lines, cursor at L4:C1)'},
    ])
  })

  test('type renders without insertion point when the caret is unreadable', async () => {
    const fake = fakeBridge({mode: 'insert', insertedLines: 0})
    const content = await run(byName('type'), {ref: 'e2', text: 'x'}, fake.call)
    expect(content).toEqual([{type: 'text', text: 'Typed into e2'}])
  })

  test('type without ref targets the focused element (focus:none path)', async () => {
    const fake = fakeBridge({mode: 'insert', insertedLines: 0, insertionPoint: {line: 1, col: 2}})
    const content = await run(byName('type'), {text: 'x', focus: 'none'}, fake.call)
    expect(fake.received[0]).toEqual({tool: 'type', params: {text: 'x', focus: 'none'}})
    expect(content).toEqual([{type: 'text', text: 'Typed into focused element (no click, cursor at L1:C2)'}])
  })

  test('press_key forwards key, modifiers and ref', async () => {
    const fake = fakeBridge({})
    const content = await run(byName('press_key'), {key: 'a', modifiers: ['ctrl'], ref: 'e2'}, fake.call)
    expect(fake.received[0]).toEqual({tool: 'press_key', params: {key: 'a', modifiers: ['ctrl'], ref: 'e2'}})
    expect(content).toEqual([{type: 'text', text: 'Pressed ctrl+a on e2'}])
  })

  test('get_text renders text and truncation marker', async () => {
    const fake = fakeBridge({text: 'print(42)', truncated: false})
    const content = await run(byName('get_text'), {ref: 'e1'}, fake.call)
    expect(fake.received[0]).toEqual({tool: 'get_text', params: {ref: 'e1'}})
    expect(content).toEqual([{type: 'text', text: 'print(42)'}])
    const truncatedFake = fakeBridge({text: 'x', truncated: true})
    const truncated = await run(byName('get_text'), {ref: 'e1'}, truncatedFake.call)
    expect(truncated).toEqual([{type: 'text', text: 'x… (TRUNCATED)'}])
  })

  test('click_at forwards button/clickCount/modifiers', async () => {
    const fake = fakeBridge({})
    const content = await run(
      byName('click_at'),
      {x: 10, y: 20, coordinates: true, button: 'right', clickCount: 2, modifiers: ['ctrl']},
      fake.call,
    )
    expect(fake.received[0]).toEqual({
      tool: 'click_at',
      params: {x: 10, y: 20, coordinates: true, button: 'right', clickCount: 2, modifiers: ['ctrl']},
    })
    expect(content).toEqual([{type: 'text', text: 'Clicked right x2 at (10, 20)'}])
  })

  test('snapshot forwards query/rootRef/limit filters', async () => {
    const fake = fakeBridge({snapshot: '- textbox "Code editor" [ref=e1]', version: 9, url: 'https://e.com', truncated: false})
    await run(byName('snapshot'), {query: 'Code editor', limit: 5000}, fake.call)
    expect(fake.received[0]).toEqual({tool: 'snapshot', params: {query: 'Code editor', limit: 5000}})
    await run(byName('snapshot'), {rootRef: 'e3'}, fake.call)
    expect(fake.received[1]).toEqual({tool: 'snapshot', params: {rootRef: 'e3'}})
  })

  test('navigate forwards waitUntil and reflects networkidle timeouts', async () => {
    const fake = fakeBridge({url: 'https://e.com', loaded: false, waitUntil: 'networkidle'})
    const content = await run(byName('navigate'), {url: 'https://e.com', waitUntil: 'networkidle'}, fake.call)
    expect(fake.received[0]).toEqual({tool: 'navigate', params: {url: 'https://e.com', waitUntil: 'networkidle'}})
    expect((content[0] as {text: string}).text).toContain('network never went idle')
  })
})

describe('tab defs', () => {
  test('tab_list renders active marker and titles', async () => {
    const fake = fakeBridge({
      tabs: [
        {tabId: 1, title: 'Docs', url: 'https://docs.example.com', active: true, groupId: 5, managed: true},
        {tabId: 2, title: '', url: 'about:blank', active: false, groupId: null, managed: false},
      ],
    })
    const tabList = byName('tab_list')
    const content = await run(tabList, {}, fake.call)
    const text = (content[0] as {text: string}).text
    expect(text).toContain('tabId=1 [active] [managed:5] https://docs.example.com — "Docs"')
    expect(text).toContain('tabId=2 about:blank')
  })

  test('tab_list renders an empty list message', async () => {
    const fake = fakeBridge({tabs: []})
    const content = await run(TAB_TOOL_DEFS[1]!, {}, fake.call)
    expect(content).toEqual([{type: 'text', text: 'No open tabs.'}])
  })

  test('tab_new returns the new tab id', async () => {
    const fake = fakeBridge({tabId: 9})
    const tabNew = byName('tab_new')
    const content = await run(tabNew, {url: 'https://example.com'}, fake.call)
    expect(content).toEqual([{type: 'text', text: 'Opened tab 9 at https://example.com'}])
  })

  test('takeover_tab confirms the tab is managed', async () => {
    const fake = fakeBridge({tabId: 4, url: 'https://leetcode.com/problems/two-sum/'})
    const content = await run(byName('takeover_tab'), {tabId: 4}, fake.call)
    expect(fake.received[0]).toEqual({tool: 'takeover_tab', params: {tabId: 4}})
    expect(content).toEqual([
      {type: 'text', text: 'Tab 4 is now managed (https://leetcode.com/problems/two-sum/).'},
    ])
  })
})

describe('evaluate defs', () => {
  test('evaluate_script renders value and type, flags truncation', async () => {
    const fake = fakeBridge({value: '{"a":1}', type: 'object', truncated: true})
    const content = await run(byName('evaluate_script'), {expression: '({a: 1})'}, fake.call)
    expect(content).toEqual([{type: 'text', text: '<object> {"a":1} (TRUNCATED)'}])
  })

  test('evaluate_script forwards awaitPromise and tabId', async () => {
    const fake = fakeBridge({value: '5', type: 'number', truncated: false})
    await run(byName('evaluate_script'), {expression: '(async () => 5)()', awaitPromise: true, tabId: 3}, fake.call)
    expect(fake.received[0]).toEqual({
      tool: 'evaluate_script',
      params: {expression: '(async () => 5)()', awaitPromise: true, tabId: 3},
    })
  })

  test('request_permission reports grant and updated list', async () => {
    const fake = fakeBridge({granted: true, domains: ['example.com']})
    const content = await run(byName('request_permission'), {domain: 'example.com'}, fake.call)
    const text = (content[0] as {text: string}).text
    expect(text).toContain('Granted example.com')
    expect(text).toContain('example.com')
  })

  test('request_permission reports denial', async () => {
    const fake = fakeBridge({granted: false, domains: []})
    const content = await run(byName('request_permission'), {domain: 'example.com'}, fake.call)
    expect(content).toEqual([{type: 'text', text: 'Permission denied by the user for example.com.'}])
  })
})
