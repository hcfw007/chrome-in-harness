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

  test('navigate flags a load timeout', async () => {
    const fake = fakeBridge({url: 'https://slow.example/', loaded: false})
    const content = await run(byName('navigate'), {url: 'https://slow.example/'}, fake.call)
    expect(content[0]).toMatchObject({type: 'text'})
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
})

describe('tab defs', () => {
  test('tab_list renders active marker and titles', async () => {
    const fake = fakeBridge({
      tabs: [
        {tabId: 1, title: 'Docs', url: 'https://docs.example.com', active: true},
        {tabId: 2, title: '', url: 'about:blank', active: false},
      ],
    })
    const tabList = byName('tab_list')
    const content = await run(tabList, {}, fake.call)
    const text = (content[0] as {text: string}).text
    expect(text).toContain('tabId=1 [active] https://docs.example.com — "Docs"')
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
