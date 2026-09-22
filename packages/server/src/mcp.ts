import type {IncomingMessage, ServerResponse} from 'node:http'
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js'
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type {WsBridge} from './ws-bridge.js'

const SERVER_NAME = 'claude-in-chrome'
const SERVER_VERSION = '0.1.0'
const MAX_BODY_BYTES = 1024 * 1024

function writeJsonRpcError(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, {'Content-Type': 'application/json'})
  res.end(JSON.stringify({jsonrpc: '2.0', error: {code: -32700, message}, id: null}))
}

async function readBodyOr400(req: IncomingMessage, res: ServerResponse): Promise<unknown> {
  try {
    return await readJsonBody(req)
  } catch (error) {
    writeJsonRpcError(res, 400, error instanceof Error ? error.message : 'Bad request')
    return undefined
  }
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk: Buffer) => {
      raw += chunk.toString('utf-8')
      if (raw.length > MAX_BODY_BYTES) {
        reject(new Error('Request body too large'))
        req.destroy()
      }
    })
    req.on('end', () => {
      if (raw.length === 0) {
        resolve(undefined)
        return
      }
      try {
        resolve(JSON.parse(raw))
      } catch {
        reject(new Error('Invalid JSON body'))
      }
    })
    req.on('error', reject)
  })
}

async function callPing(wsBridge: WsBridge): Promise<string> {
  try {
    const result = await wsBridge.sendToExtension('ping', {})
    return JSON.stringify(result, null, 2)
  } catch (error) {
    return error instanceof Error
      ? `Error: ${error.message}`
      : 'Error: unknown failure while contacting the extension'
  }
}

function createMcpServer(wsBridge: WsBridge): McpServer {
  const server = new McpServer(
    {name: SERVER_NAME, version: SERVER_VERSION},
    {instructions: 'Tools that operate on a real Chrome browser via a local extension bridge.'},
  )
  server.registerTool(
    'ping',
    {
      title: 'Ping the Chrome extension',
      description:
        'Check connectivity with the Chrome extension. Returns its version and userAgent.',
      inputSchema: {},
    },
    async () => {
      const text = await callPing(wsBridge)
      const isError = text.startsWith('Error:')
      return {content: [{type: 'text', text}], isError}
    },
  )
  return server
}

export async function handleMcpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  wsBridge: WsBridge,
): Promise<void> {
  const body = await readBodyOr400(req, res)
  if (body === undefined) return

  const server = createMcpServer(wsBridge)
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })
  res.on('close', () => {
    void transport.close()
    void server.close()
  })
  await server.connect(transport)
  await transport.handleRequest(req, res, body)
}
