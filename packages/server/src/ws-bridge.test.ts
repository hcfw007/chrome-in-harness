import {PROTOCOL_VERSION, isWsRequest} from '@chrome-in-harness/protocol'
import {afterEach, describe, expect, test} from 'vitest'
import {WebSocket} from 'ws'
import {TOOL_WAIT_MARGIN_MS, WsBridge, requestTimeoutFor, type WsBridgeOptions} from './ws-bridge.js'

const EXTENSION_ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop'

function requirePort(started: WsBridge): number {
  const port = started.boundPort
  if (port === null) throw new Error('bridge is not listening')
  return port
}

let bridge: WsBridge | null = null
const clients: WebSocket[] = []

afterEach(() => {
  for (const client of clients.splice(0)) client.close()
  bridge?.close()
  bridge = null
})

async function startBridge(options: Partial<WsBridgeOptions> = {}): Promise<WsBridge> {
  const started = new WsBridge({port: 0, ...options})
  bridge = started
  await started.start()
  return started
}

function openClient(port: number, origin = EXTENSION_ORIGIN): WebSocket {
  const client = new WebSocket(`ws://127.0.0.1:${port}`, {origin})
  clients.push(client)
  return client
}

/** 连上并开始把收到的请求按 respond 生成的响应回发。 */
function connectExtension(
  port: number,
  respond: (tool: string, params: unknown) => Record<string, unknown>,
): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const client = openClient(port)
    client.on('error', reject)
    client.on('message', (data) => {
      const parsed: unknown = JSON.parse(data.toString())
      if (!isWsRequest(parsed)) return
      client.send(JSON.stringify({v: PROTOCOL_VERSION, id: parsed.id, ...respond(parsed.tool, parsed.params)}))
    })
    client.on('open', () => resolve(client))
  })
}

describe('WsBridge origin enforcement', () => {
  test('accepts a connection from a chrome extension', async () => {
    const started = await startBridge()
    const port = requirePort(started)
    await new Promise<void>((resolve, reject) => {
      const client = openClient(port)
      client.on('open', () => resolve())
      client.on('error', reject)
    })
    expect(started.isConnected).toBe(true)
  })

  test('rejects a connection from a web page origin', async () => {
    const started = await startBridge()
    const port = requirePort(started)
    const error = await new Promise<Error>((resolve) => {
      const client = openClient(port, 'https://evil.example.com')
      client.on('error', resolve)
    })
    expect(error.message).toContain('403')
    expect(started.isConnected).toBe(false)
  })
})

describe('WsBridge request correlation', () => {
  test('resolves a call with the result matching its id', async () => {
    const started = await startBridge()
    await connectExtension(requirePort(started), (tool) => ({ok: true, result: {tool}}))
    await expect(started.sendToExtension('ping', {})).resolves.toEqual({tool: 'ping'})
  })

  test('rejects a call when the extension reports an error', async () => {
    const started = await startBridge()
    await connectExtension(requirePort(started), () => ({ok: false, error: 'tool exploded'}))
    await expect(started.sendToExtension('ping', {})).rejects.toThrow('tool exploded')
  })

  test('keeps concurrent calls apart by id', async () => {
    const started = await startBridge()
    await connectExtension(requirePort(started), (tool, params) => ({ok: true, result: params}))
    const [first, second] = await Promise.all([
      started.sendToExtension('ping', {n: 1}),
      started.sendToExtension('ping', {n: 2}),
    ])
    expect(first).toEqual({n: 1})
    expect(second).toEqual({n: 2})
  })

  test('rejects with EXTENSION_DISCONNECTED and setup steps when it never connected', async () => {
    const started = await startBridge()
    const call = started.sendToExtension('ping', {})
    await expect(call).rejects.toThrow(/^EXTENSION_DISCONNECTED: .*has not connected since this server started/)
    await expect(started.sendToExtension('ping', {})).rejects.toThrow('enabled on chrome://extensions')
  })

  test('rejects an in-flight call when the extension disconnects, warning it may have taken effect', async () => {
    const started = await startBridge()
    const client = await connectExtension(requirePort(started), () => ({ok: true, result: null}))
    client.removeAllListeners('message')
    const inFlight = started.sendToExtension('ping', {})
    client.close()
    await expect(inFlight).rejects.toThrow(/^EXTENSION_DISCONNECTED: .*may or may not have taken effect/)
  })

  test('right after a disconnect, suggests waiting for the reconnect instead of setup steps', async () => {
    const started = await startBridge()
    const client = await connectExtension(requirePort(started), () => ({ok: true, result: null}))
    await new Promise<void>((resolve) => {
      client.once('close', () => resolve())
      client.close()
    })
    // 等 server 侧处理完 close 事件
    await new Promise((resolve) => setTimeout(resolve, 20))
    await expect(started.sendToExtension('ping', {})).rejects.toThrow(/probably reconnecting .* wait a few seconds/)
  })

  test('extends the bridge timeout for tools that wait on their own (timeoutMs + margin)', async () => {
    const started = await startBridge({requestTimeoutMs: 50})
    const client = await connectExtension(requirePort(started), () => ({ok: true, result: null}))
    client.removeAllListeners('message')
    // 扩展 120ms 后才回包：基线 50ms 会超时，但调用自带 timeoutMs=100 → 桥超时放宽到 100 + 余量
    client.on('message', (raw: Buffer) => {
      const request = JSON.parse(raw.toString()) as {id: string}
      setTimeout(() => client.send(JSON.stringify({v: 1, id: request.id, ok: true, result: 'late'})), 120)
    })
    await expect(started.sendToExtension('wait', {timeoutMs: 100})).resolves.toBe('late')
  })

  test('requestTimeoutFor only honors a finite positive numeric timeoutMs', () => {
    expect(requestTimeoutFor({timeoutMs: 30_000}, 30_000)).toBe(30_000 + TOOL_WAIT_MARGIN_MS)
    expect(requestTimeoutFor({timeoutMs: 1_000}, 30_000)).toBe(30_000)
    expect(requestTimeoutFor({timeoutMs: '99999'}, 30_000)).toBe(30_000)
    expect(requestTimeoutFor({timeoutMs: Number.POSITIVE_INFINITY}, 30_000)).toBe(30_000)
    expect(requestTimeoutFor(undefined, 30_000)).toBe(30_000)
  })

  test('requestTimeoutFor sums the waits of run_actions steps, which run sequentially', () => {
    const batch = {
      actions: [
        {tool: 'wait', params: {timeoutMs: 20_000}},
        {tool: 'click', params: {ref: 'e1'}},
        {tool: 'wait_for_response', params: {urlContains: '/api', timeoutMs: 15_000}},
        {tool: 'press_key'},
      ],
    }
    expect(requestTimeoutFor(batch, 30_000)).toBe(35_000 + TOOL_WAIT_MARGIN_MS)
  })

  test('times out with TOOL_TIMEOUT and likely causes', async () => {
    const started = await startBridge({requestTimeoutMs: 50})
    const client = await connectExtension(requirePort(started), () => ({ok: true, result: null}))
    client.removeAllListeners('message')
    await expect(started.sendToExtension('ping', {})).rejects.toThrow(/^TOOL_TIMEOUT: .*within 50ms .*DevTools/)
  })
})
