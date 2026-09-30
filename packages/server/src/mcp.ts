import type {IncomingMessage, ServerResponse} from 'node:http'
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js'
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import {registerAllTools} from './tools/index.js'
import type {WsBridge} from './ws-bridge.js'

const SERVER_NAME = 'chrome-in-harness'
const SERVER_VERSION = '0.1.0'
const MAX_BODY_BYTES = 1024 * 1024

const PARSE_ERROR = -32700
const INVALID_REQUEST = -32600

class BodyTooLargeError extends Error {
  constructor() {
    super('Request body too large')
  }
}

function writeJsonRpcError(res: ServerResponse, status: number, code: number, message: string): void {
  res.writeHead(status, {'Content-Type': 'application/json'})
  res.end(JSON.stringify({jsonrpc: '2.0', error: {code, message}, id: null}))
}

async function readBodyOr400(req: IncomingMessage, res: ServerResponse): Promise<unknown> {
  try {
    return await readJsonBody(req)
  } catch (error) {
    const code = error instanceof BodyTooLargeError ? INVALID_REQUEST : PARSE_ERROR
    writeJsonRpcError(res, 400, code, error instanceof Error ? error.message : 'Bad request')
    return undefined
  }
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk: Buffer) => {
      raw += chunk.toString('utf-8')
      if (raw.length > MAX_BODY_BYTES) {
        reject(new BodyTooLargeError())
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

function createMcpServer(wsBridge: WsBridge): McpServer {
  const server = new McpServer(
    {name: SERVER_NAME, version: SERVER_VERSION},
    {
      instructions:
        'Tools that operate on a real Chrome browser via a local extension bridge. ' +
        'Pages are read via accessibility snapshots with [ref=eN] ids; interactive tools accept those refs.',
    },
  )
  registerAllTools(server, (tool, params) => wsBridge.sendToExtension(tool, params))
  return server
}

/**
 * DNS rebinding 防护：
 * - allowedHosts 强制校验 Host，恶意域名解析到 127.0.0.1 后 Host 不匹配即被拒
 * - allowedOrigins 仅在 Origin 存在时校验：浏览器页面必带 Origin 会被拒，
 *   非浏览器 MCP 客户端不带 Origin，正常放行
 */
function localOnlyOrigins(port: number): {allowedHosts: string[]; allowedOrigins: string[]} {
  const hosts = [`127.0.0.1:${port}`, `localhost:${port}`]
  return {allowedHosts: hosts, allowedOrigins: hosts.map((host) => `http://${host}`)}
}

export async function handleMcpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  wsBridge: WsBridge,
  port: number,
): Promise<void> {
  const body = await readBodyOr400(req, res)
  if (body === undefined) return

  const server = createMcpServer(wsBridge)
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    enableDnsRebindingProtection: true,
    ...localOnlyOrigins(port),
  })
  res.on('close', () => {
    void transport.close()
    void server.close()
  })
  await server.connect(transport)
  await transport.handleRequest(req, res, body)
}
