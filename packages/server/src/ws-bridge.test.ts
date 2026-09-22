import {PROTOCOL_VERSION, isWsRequest} from '@cic/protocol'
import {afterEach, describe, expect, test} from 'vitest'
import {WebSocket} from 'ws'
import {WsBridge, type WsBridgeOptions} from './ws-bridge.js'

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

  test('rejects when no extension is connected', async () => {
    const started = await startBridge()
    await expect(started.sendToExtension('ping', {})).rejects.toThrow('not connected')
  })

  test('rejects an in-flight call when the extension disconnects', async () => {
    const started = await startBridge()
    const client = await connectExtension(requirePort(started), () => ({ok: true, result: null}))
    client.removeAllListeners('message')
    const inFlight = started.sendToExtension('ping', {})
    client.close()
    await expect(inFlight).rejects.toThrow('Extension disconnected')
  })

  test('times out a call the extension never answers', async () => {
    const started = await startBridge({requestTimeoutMs: 50})
    const client = await connectExtension(requirePort(started), () => ({ok: true, result: null}))
    client.removeAllListeners('message')
    await expect(started.sendToExtension('ping', {})).rejects.toThrow('timed out after 50ms')
  })
})
