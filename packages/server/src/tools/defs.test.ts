import {TOOL_NAMES} from '@chrome-in-harness/protocol'
import {describe, expect, test} from 'vitest'
import {BATCH_TOOL_DEFS} from './defs-batch.js'
import {BROWSER_TOOL_DEFS} from './defs-browser.js'
import {DEBUG_TOOL_DEFS} from './defs-debug.js'
import {EVALUATE_TOOL_DEFS} from './defs-evaluate.js'
import {TAB_TOOL_DEFS, waitForFreshExtension} from './defs-tabs.js'
import {formatError} from './types.js'
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

const ALL = [...TAB_TOOL_DEFS, ...BATCH_TOOL_DEFS, ...BROWSER_TOOL_DEFS, ...DEBUG_TOOL_DEFS, ...EVALUATE_TOOL_DEFS]

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

  test('server exposes exactly the shared tool name contract (no dropped tools)', () => {
    expect([...ALL].map((def) => def.name).sort()).toEqual([...TOOL_NAMES].sort())
  })
})

describe('formatError', () => {
  test('passes the coded message through without an "Error: " prefix (clients add their own)', () => {
    expect(formatError(new Error('STALE_REF: ref e1 is stale — snapshot again'))).toEqual([
      {type: 'text', text: 'STALE_REF: ref e1 is stale — snapshot again'},
    ])
    expect(formatError('plain')).toEqual([{type: 'text', text: 'plain'}])
  })
})

describe('reload_extension def', () => {
  /** 按调用顺序返回预设结果的桥：ping 依次给出 startedAt 序列。 */
  function scriptedBridge(pings: Array<unknown | Error>) {
    const received: string[] = []
    const call: BridgeCall = async (tool) => {
      received.push(tool)
      if (tool === 'reload_extension') return {reloading: true, version: '0.3.0'}
      const next = pings.shift()
      if (next instanceof Error) throw next
      return next
    }
    return {call, received}
  }

  test('waitForFreshExtension resolves once ping reports a new startedAt, skipping disconnects', async () => {
    const {call} = scriptedBridge([
      new Error('Chrome extension not connected'),
      {version: '0.3.0', userAgent: 'x', startedAt: 100},
      {version: '0.3.0', userAgent: 'x', startedAt: 200},
    ])
    const fresh = await waitForFreshExtension(call, 100, 5_000, async () => {})
    expect(fresh).toEqual({reconnected: true, startedAt: 200})
  })

  test('waitForFreshExtension accepts any reconnect when the old extension had no startedAt', async () => {
    const {call} = scriptedBridge([{version: '0.3.0', userAgent: 'x'}])
    await expect(waitForFreshExtension(call, undefined, 5_000, async () => {})).resolves.toEqual({reconnected: true})
  })

  test('waitForFreshExtension gives up after the timeout', async () => {
    const {call} = scriptedBridge(Array.from({length: 50}, () => new Error('not connected')))
    await expect(waitForFreshExtension(call, 1, 0, async () => {})).resolves.toEqual({reconnected: false})
  })
})

describe('run_actions def', () => {
  test('forwards the batch and renders per-step status', async () => {
    const fake = fakeBridge({
      steps: [
        {index: 0, tool: 'press_key', ok: true, result: {}},
        {index: 1, tool: 'navigate', ok: true, result: {url: 'https://example.com', loaded: true}},
        {index: 2, tool: 'press_key', ok: false, error: 'KEY_PIPELINE_DEAD: dead'},
      ],
    })
    const args = {tabId: 7, actions: [{tool: 'press_key', params: {key: 'a'}}]}
    const content = await run(byName('run_actions'), args, fake.call)
    expect(fake.received[0]).toEqual({tool: 'run_actions', params: args})
    const text = (content[0] as {text: string}).text
    expect(text).toContain('1. press_key ok')
    expect(text).toContain('2. navigate ok — {"url":"https://example.com","loaded":true}')
    expect(text).toContain('3. press_key failed: KEY_PIPELINE_DEAD: dead')
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

  test('click with snapshot: true appends the fresh snapshot', async () => {
    const fake = fakeBridge({snapshot: {snapshot: '- button "OK" [ref=e1-ab]', version: 5, url: 'https://e.com', truncated: false}})
    const content = await run(byName('click'), {ref: 'e3', snapshot: true}, fake.call)
    expect(fake.received[0]).toEqual({tool: 'click', params: {ref: 'e3', snapshot: true}})
    const text = (content[0] as {text: string}).text
    expect(text).toContain('Clicked e3')
    expect(text).toContain('version 5')
    expect(text).toContain('[ref=e1-ab]')
  })

  test('click reports a snapshot failure without failing the click', async () => {
    const fake = fakeBridge({snapshotError: 'detached'})
    const content = await run(byName('click'), {ref: 'e3', snapshot: true}, fake.call)
    expect((content[0] as {text: string}).text).toBe('Clicked e3 (snapshot failed: detached; call snapshot to continue)')
  })

  test('click reports a dialog that stayed open instead of retrying', async () => {
    const fake = fakeBridge({dialogStillOpen: true})
    const content = await run(byName('click'), {ref: 'e3'}, fake.call)
    expect(fake.received).toHaveLength(1)
    expect((content[0] as {text: string}).text).toBe('Clicked e3 (a dialog is still open)')
  })

  test('type reports the resulting field value', async () => {
    const fake = fakeBridge({mode: 'insert', insertedLines: 0, value: '懒加载销售'})
    const content = await run(byName('type'), {ref: 'e2', text: '懒加载销售', clear: true}, fake.call)
    expect((content[0] as {text: string}).text).toBe('Typed into e2 (cleared first)\nValue now: "懒加载销售"')
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

  test('wait rejects multiple conditions, or no condition without timeoutMs, before calling the bridge', async () => {
    const fake = fakeBridge({matched: true, timedOut: false})
    await expect(run(byName('wait'), {}, fake.call)).rejects.toThrow('only timeoutMs for a plain delay')
    await expect(
      run(byName('wait'), {text: 'a', selector: '#x'}, fake.call),
    ).rejects.toThrow('at most one')
    await expect(
      run(byName('wait'), {networkIdle: true, urlContains: '/x'}, fake.call),
    ).rejects.toThrow('at most one')
    expect(fake.received).toHaveLength(0)
  })

  test('wait with only timeoutMs is a plain delay', async () => {
    const fake = fakeBridge({matched: true, timedOut: false})
    const content = await run(byName('wait'), {timeoutMs: 1500}, fake.call)
    expect(fake.received).toEqual([{tool: 'wait', params: {timeoutMs: 1500}}])
    expect(content).toEqual([{type: 'text', text: 'Waited 1500ms.'}])
  })

  test('wait networkIdle reports idle or timeout', async () => {
    const idle = await run(byName('wait'), {networkIdle: true}, fakeBridge({matched: true, timedOut: false}).call)
    expect(idle).toEqual([{type: 'text', text: 'Network idle.'}])
    const busy = await run(byName('wait'), {networkIdle: true}, fakeBridge({matched: false, timedOut: true}).call)
    expect((busy[0] as {text: string}).text).toContain('Timed out')
  })

  test('scroll_to requires exactly one locator and renders the receipt', async () => {
    const fake = fakeBridge({rect: {x: 10, y: 300, width: 80, height: 20}, inViewport: true, tag: 'button', text: '导出'})
    await expect(run(byName('scroll_to'), {}, fake.call)).rejects.toThrow('exactly one of ref / selector / text')
    await expect(run(byName('scroll_to'), {ref: 'e1', text: 'x'}, fake.call)).rejects.toThrow('got 2')
    const content = await run(byName('scroll_to'), {text: '导出'}, fake.call)
    expect(fake.received).toEqual([{tool: 'scroll_to', params: {text: '导出'}}])
    expect(content).toEqual([{type: 'text', text: 'Scrolled to <button> "导出" rect=10,300 80x20 — in viewport'}])
  })

  test('probe renders found elements with rect, visibility, match count and attrs', async () => {
    const fake = fakeBridge({
      exists: true,
      count: 3,
      visible: true,
      inViewport: false,
      rect: {x: 10, y: 1400, width: 80, height: 24},
      tag: 'button',
      text: '导出',
      attrs: {class: 'ant-btn', disabled: ''},
    })
    const content = await run(byName('probe'), {selector: '.ant-btn'}, fake.call)
    expect((content[0] as {text: string}).text).toBe(
      '<button> "导出" — first of 3 matches\nrect=10,1400 80x24 — visible, outside viewport\nattrs: class="ant-btn" disabled=""',
    )
  })

  test('probe reports a missing element without erroring, and validates the locator', async () => {
    const fake = fakeBridge({exists: false, count: 0})
    const content = await run(byName('probe'), {selector: '#nope'}, fake.call)
    expect(content).toEqual([{type: 'text', text: 'Not found (0 matches for "#nope").'}])
    await expect(run(byName('probe'), {}, fake.call)).rejects.toThrow('exactly one of ref / selector / text')
  })

  test('get_html flags truncation with the original length', async () => {
    const fake = fakeBridge({html: '<div class="x">', length: 9000, truncated: true})
    const content = await run(byName('get_html'), {selector: '.x', maxChars: 15}, fake.call)
    expect(fake.received[0]).toEqual({tool: 'get_html', params: {selector: '.x', maxChars: 15}})
    expect((content[0] as {text: string}).text).toContain('TRUNCATED: showing 15 of 9000 chars')
  })

  test('wait_for_response renders the matched entry or a timeout hint', async () => {
    const hit = fakeBridge({
      matched: true,
      timedOut: false,
      entry: {method: 'POST', url: 'https://a.com/api/sync', status: 500, mimeType: 'application/json', timestamp: 1, durationMs: 42},
    })
    const ok = await run(byName('wait_for_response'), {urlContains: '/api/sync'}, hit.call)
    expect(ok).toEqual([{type: 'text', text: 'Matched: POST https://a.com/api/sync → 500 application/json (42ms)'}])

    const miss = fakeBridge({matched: false, timedOut: true})
    const timeout = await run(byName('wait_for_response'), {urlContains: '/api/sync', method: 'POST', status: 200}, miss.call)
    expect((timeout[0] as {text: string}).text).toContain('no POST 200 request matching "/api/sync"')
  })

  test('read_network shows durations and pending requests', async () => {
    const fake = fakeBridge({
      entries: [
        {method: 'GET', url: 'https://a.com/slow', timestamp: 2},
        {method: 'GET', url: 'https://a.com/x', status: 200, mimeType: 'text/html', timestamp: 1, durationMs: 120},
        {method: 'POST', url: 'https://a.com/y', error: 'cors:MissingAllowOriginHeader', timestamp: 0, durationMs: 8},
      ],
    })
    const content = await run(byName('read_network'), {}, fake.call)
    expect((content[0] as {text: string}).text).toBe(
      'GET https://a.com/slow → pending\nGET https://a.com/x → 200 text/html (120ms)\nPOST https://a.com/y → ERR cors:MissingAllowOriginHeader (8ms)',
    )
  })

  test('reload forwards hard and reports cache bypass', async () => {
    const fake = fakeBridge({url: 'https://e.com/a', title: 'A', loaded: true, hard: true})
    const content = await run(byName('reload'), {hard: true}, fake.call)
    expect(fake.received).toEqual([{tool: 'reload', params: {hard: true}}])
    expect(content).toEqual([{type: 'text', text: 'Hard-reloaded (cache bypassed) https://e.com/a — "A"'}])
  })

  test('screenshot tells the agent to divide by dpr when downscaling fell back to device pixels', async () => {
    const fake = fakeBridge({data: 'aGVsbG8=', mimeType: 'image/png', width: 1280, height: 720, dpr: 2, scale: 1})
    const content = await run(byName('screenshot'), {}, fake.call)
    expect((content[1] as {text: string}).text).toBe(
      'Viewport 1280x720 CSS px, dpr 2; image px = DEVICE px (downscaling was unavailable) — ' +
        'divide coordinates measured on the image by 2 before passing them to click_at.',
    )
  })

  test('screenshot at dpr 1 needs no conversion', async () => {
    const fake = fakeBridge({data: 'aGVsbG8=', mimeType: 'image/png', width: 1280, height: 720, dpr: 1, scale: 1})
    const content = await run(byName('screenshot'), {}, fake.call)
    expect((content[1] as {text: string}).text).toBe(
      'Viewport 1280x720 CSS px, dpr 1; image px = CSS px — use these coordinates with click_at.',
    )
  })

  test('screenshot reports the real image-to-CSS ratio for a downscaled wide viewport', async () => {
    const fake = fakeBridge({
      data: 'aGVsbG8=', mimeType: 'image/png', width: 2560, height: 1267, dpr: 1, scale: 0.6125,
      imageWidth: 1568, imageHeight: 776, cssScale: 0.6125,
    })
    const content = await run(byName('screenshot'), {}, fake.call)
    expect((content[1] as {text: string}).text).toBe(
      'Viewport 2560x1267 CSS px, dpr 1; image 1568x776 — 1 image px = 1.63 CSS px. ' +
        'Pass coordinates measured on this image to click_at with space:"image".',
    )
  })

  test('screenshot says no conversion is needed when the image matches CSS pixels', async () => {
    const fake = fakeBridge({
      data: 'aGVsbG8=', mimeType: 'image/png', width: 1280, height: 720, dpr: 2, scale: 0.5,
      imageWidth: 1280, imageHeight: 720, cssScale: 1,
    })
    const content = await run(byName('screenshot'), {}, fake.call)
    expect((content[1] as {text: string}).text).toBe(
      'Viewport 1280x720 CSS px, dpr 2; image 1280x720 — image px = CSS px, use these coordinates with click_at directly.',
    )
  })

  test('hover by selector reports the element and point', async () => {
    const fake = fakeBridge({x: 120, y: 40.25, tag: 'span'})
    const content = await run(byName('hover'), {selector: '[data-testid="lazy"]'}, fake.call)
    expect(fake.received[0]).toEqual({tool: 'hover', params: {selector: '[data-testid="lazy"]'}})
    expect((content[0] as {text: string}).text).toBe('Hovered "[data-testid=\\"lazy\\"]" <span> at (120, 40.3)')
  })

  test('hover rejects ambiguous locators before reaching the extension', async () => {
    const fake = fakeBridge({})
    await expect(run(byName('hover'), {ref: 'e1', x: 1, y: 2}, fake.call)).rejects.toThrow('exactly one of')
    expect(fake.received).toHaveLength(0)
  })

  test('select_option reports the chosen option and the field value', async () => {
    const fake = fakeBridge({kind: 'custom', selected: '懒加载销售', value: '懒加载销售'})
    const content = await run(byName('select_option'), {ref: 'e7', text: '懒加载销售'}, fake.call)
    expect((content[0] as {text: string}).text).toBe('Selected "懒加载销售" in e7 (custom select); field now shows "懒加载销售"')
  })

  test('click_at with space:"image" reports the converted CSS point', async () => {
    const fake = fakeBridge({css: {x: 270, y: 174}})
    const content = await run(byName('click_at'), {x: 165.4, y: 106.6, coordinates: true, space: 'image'}, fake.call)
    expect(fake.received[0]?.params).toMatchObject({space: 'image'})
    expect((content[0] as {text: string}).text).toBe('Clicked at image (165.4, 106.6) → CSS (270, 174)')
  })

  test('screenshot appends viewport metrics when the extension reports them', async () => {
    const fake = fakeBridge({data: 'aGVsbG8=', mimeType: 'image/png', width: 1280, height: 720, dpr: 2, scale: 0.5})
    const content = await run(byName('screenshot'), {}, fake.call)
    expect(content[0]).toEqual({type: 'image', data: 'aGVsbG8=', mimeType: 'image/png'})
    expect((content[1] as {text: string}).text).toBe(
      'Viewport 1280x720 CSS px, dpr 2; image px = CSS px (downscaled from dpr 2) — use these coordinates with click_at.',
    )
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

  test('type flags unverified landing inside a cross-origin iframe', async () => {
    const fake = fakeBridge({mode: 'insert', insertedLines: 0, unverified: true})
    const content = await run(byName('type'), {text: 'x', focus: 'none'}, fake.call)
    expect((content[0] as {text: string}).text).toContain('Unverified: focus is inside a cross-origin iframe')
  })

  test('type reports the iframe the text landed in', async () => {
    const fake = fakeBridge({mode: 'insert', insertedLines: 0, frame: 'iframe[1] "runner-2" https://js.example/koko/'})
    const content = await run(byName('type'), {text: 'x', focus: 'none', submit: true}, fake.call)
    expect((content[0] as {text: string}).text).toBe(
      'Typed into focused element (no click) and pressed Enter\nLanded in frame: iframe[1] "runner-2" https://js.example/koko/',
    )
  })

  test('type set mode reports the monaco setValue path', async () => {
    const fake = fakeBridge({mode: 'set', insertedLines: 7, insertionPoint: {line: 8, col: 1}})
    const content = await run(byName('type'), {text: 'code'}, fake.call)
    expect(fake.received[0]).toEqual({tool: 'type', params: {text: 'code'}})
    expect(content).toEqual([
      {type: 'text', text: 'Typed into focused element (set via monaco setValue, 8 lines, cursor at L8:C1)'},
    ])
  })

  test('type set mode surfaces layoutRecovered when a collapsed editor was healed', async () => {
    const fake = fakeBridge({
      mode: 'set',
      insertedLines: 0,
      insertionPoint: {line: 1, col: 1},
      layoutRecovered: true,
    })
    const content = await run(byName('type'), {text: 'code'}, fake.call)
    expect((content[0] as {text: string}).text).toContain('layout recovered')
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

  test('click_at reports the hit element and its interactive target', async () => {
    const fake = fakeBridge({
      hit: {
        tag: 'span',
        id: 'lbl',
        text: '保存',
        rect: {x: 10, y: 20, width: 30, height: 12},
        interactive: {tag: 'button', text: '保存'},
      },
    })
    const content = await run(byName('click_at'), {x: 25, y: 26, coordinates: true}, fake.call)
    expect((content[0] as {text: string}).text).toBe(
      'Clicked at (25, 26)\nHit: <span#lbl> "保存" rect=10,20 30x12\nInteractive target: <button> "保存"',
    )
  })

  test('click_at flags a hit with no clickable element and an empty point', async () => {
    const plain = fakeBridge({hit: {tag: 'div', text: '', rect: {x: 0, y: 0, width: 800, height: 600}}})
    const plainText = (await run(byName('click_at'), {x: 1, y: 1, coordinates: true}, plain.call))[0] as {text: string}
    expect(plainText.text).toContain('Note: no clickable element')

    const empty = fakeBridge({hit: null})
    const emptyText = (await run(byName('click_at'), {x: 1, y: 1, coordinates: true}, empty.call))[0] as {text: string}
    expect(emptyText.text).toContain('Hit: nothing at this point')
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

  test('tab tools instruct agents to preserve focus unless explicitly requested', () => {
    expect(byName('tab_new').description).toContain('background')
    expect(byName('tab_select').description).toContain('explicitly asks')
    expect(byName('tab_select').description).toContain('notify the user')
  })

  test.each([true, false])('ensure_tab returns a reusable tab handle: reused=%s', async (reused) => {
    const fake = fakeBridge({tabId: 9, url: 'https://example.com', reused})
    const content = await run(byName('ensure_tab'), {tabId: 4, url: 'https://example.com'}, fake.call)
    expect(fake.received[0]).toEqual({tool: 'ensure_tab', params: {tabId: 4, url: 'https://example.com'}})
    expect(JSON.parse((content[0] as {text: string}).text)).toEqual({tabId: 9, url: 'https://example.com', reused})
    expect(byName('ensure_tab').description).toContain('Save')
  })

  test('ensure_tab tells the agent its old tab was closed and to save the replacement id', async () => {
    const fake = fakeBridge({tabId: 9, url: 'about:blank', reused: false, replacedTabId: 4})
    const content = await run(byName('ensure_tab'), {tabId: 4}, fake.call)
    const parsed = JSON.parse((content[0] as {text: string}).text)
    expect(parsed).toMatchObject({tabId: 9, reused: false, replacedTabId: 4})
    expect(parsed.note).toBe('tab 4 was closed; opened tab 9 instead. Use tabId 9 from now on.')
  })

  test('takeover_tab confirms the tab is managed', async () => {
    const fake = fakeBridge({tabId: 4, url: 'https://leetcode.com/problems/two-sum/'})
    const content = await run(byName('takeover_tab'), {tabId: 4}, fake.call)
    expect(fake.received[0]).toEqual({tool: 'takeover_tab', params: {tabId: 4}})
    expect(content).toEqual([
      {
        type: 'text',
        text: 'Tab 4 is now managed (https://leetcode.com/problems/two-sum/). Focus and URL were not changed.',
      },
    ])
  })

  test('takeover_tab warns when the tab is the one the user is viewing, and reports no-ops', async () => {
    const viewing = fakeBridge({tabId: 4, url: 'https://a.com/', alreadyManaged: false, active: true})
    const text = ((await run(byName('takeover_tab'), {tabId: 4}, viewing.call))[0] as {text: string}).text
    expect(text).toContain('the tab the user is currently viewing')
    expect(text).toContain('Pass tabId explicitly')

    const noop = fakeBridge({tabId: 4, url: 'https://a.com/', alreadyManaged: true, active: false})
    const noopText = ((await run(byName('takeover_tab'), {tabId: 4}, noop.call))[0] as {text: string}).text
    expect(noopText).toBe('Tab 4 was already managed (https://a.com/); nothing changed.')
  })
})

describe('evaluate defs', () => {
  test('evaluate_script returns the bare JSON value and flags truncation on its own line', async () => {
    const fake = fakeBridge({value: '{"a":1}', type: 'object', truncated: true})
    const content = await run(byName('evaluate_script'), {expression: '({a: 1})'}, fake.call)
    expect(content).toEqual([{type: 'text', text: '{"a":1}\n[TRUNCATED]'}])
  })

  test('evaluate_script reports kept and original length when truncated', async () => {
    const fake = fakeBridge({value: 'abc…', type: 'string', truncated: true, originalLength: 9000})
    const content = await run(byName('evaluate_script'), {expression: 's'}, fake.call)
    expect(content).toEqual([{type: 'text', text: '"abc…"\n[TRUNCATED: kept 3 of 9000 chars]'}])
  })

  test('evaluate_script output parses as JSON for strings, numbers and booleans', async () => {
    const cases: Array<[unknown, string, unknown]> = [
      ['he said "hi"', 'string', 'he said "hi"'],
      ['42', 'number', 42],
      ['true', 'boolean', true],
      ['[1,2]', 'object', [1, 2]],
      ['null', 'object', null],
    ]
    for (const [value, type, parsed] of cases) {
      const fake = fakeBridge({value, type, truncated: false})
      const content = await run(byName('evaluate_script'), {expression: 'x'}, fake.call)
      expect(JSON.parse((content[0] as {text: string}).text)).toEqual(parsed)
    }
  })

  test('evaluate_script text contract: every non-truncated type parses (undefined stays a bare word)', async () => {
    const cases: Array<[string, string, string]> = [
      ['', 'string', '""'],
      ['{"a":1}', 'object', '{"a":1}'],
      ['undefined', 'undefined', 'undefined'],
    ]
    for (const [value, type, text] of cases) {
      const fake = fakeBridge({value, type, truncated: false})
      const content = await run(byName('evaluate_script'), {expression: 'x'}, fake.call)
      expect((content[0] as {text: string}).text).toBe(text)
    }
  })

  test('evaluate_script truncated objects keep the marker on its own line', async () => {
    const fake = fakeBridge({value: '{"t":"oo…', type: 'object', truncated: true, originalLength: 210008})
    const content = await run(byName('evaluate_script'), {expression: 'x'}, fake.call)
    const text = (content[0] as {text: string}).text
    expect(text.split('\n').at(-1)).toBe('[TRUNCATED: kept 8 of 210008 chars]')
    expect(() => JSON.parse(text)).toThrow()
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
