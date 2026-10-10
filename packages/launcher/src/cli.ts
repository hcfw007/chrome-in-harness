#!/usr/bin/env node
/**
 * chrome-in-harness launcher：一条命令完成「检查/引导装扩展 + 起 server + 写 MCP 配置」。
 *
 * 用法：
 *   npx @chrome-in-harness/launcher           检查环境并给出下一步
 *   npx @chrome-in-harness/launcher start     启动本地 server（前台，Ctrl-C 退出）
 *   npx @chrome-in-harness/launcher doctor    完整环境自检
 */

import {spawn} from 'node:child_process'
import {existsSync} from 'node:fs'
import {mkdir, readFile, writeFile} from 'node:fs/promises'
import net from 'node:net'
import {homedir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const SERVER_URL = 'http://127.0.0.1:12306/mcp'
const WS_PORT = 8765
const HTTP_PORT = 12306

type Command = 'start' | 'doctor' | 'help'

export function parseArgs(argv: string[]): Command {
  const cmd = argv[2] ?? 'help'
  if (cmd === 'start' || cmd === 'doctor') return cmd
  return 'help'
}

function log(msg: string): void {
  console.log(msg)
}

/** 探测 MCP 端口是否已有 server 监听（TCP 握手比 MCP 协议探测更可靠）。 */
function isServerRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    socket.setTimeout(1000)
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('timeout', () => {
      socket.destroy()
      resolve(false)
    })
    socket.once('error', () => {
      socket.destroy()
      resolve(false)
    })
    socket.connect(HTTP_PORT, '127.0.0.1')
  })
}

async function detectClients(): Promise<void> {
  const home = process.env['HOME'] ?? ''
  const cwd = process.cwd()

  const opencodeGlobal = path.join(home, '.config', 'opencode', 'opencode.json')
  const opencodeJson = path.join(cwd, 'opencode.json')
  const opencodeJsonc = path.join(cwd, 'opencode.jsonc')
  const mcpJson = path.join(cwd, '.mcp.json')
  const claudeConfig = path.join(home, '.claude.json')

  const found: string[] = []
  for (const p of [opencodeGlobal, opencodeJson, opencodeJsonc, mcpJson, claudeConfig]) {
    if (existsSync(p)) found.push(p)
  }
  if (found.length === 0) {
    log('  未发现现有 MCP 客户端配置文件（opencode / .mcp.json / claude）。')
  } else {
    log(`  发现配置文件：${found.join(', ')}`)
  }
}

/** 检测扩展是否已装：通过 MCP tools/call ping 验证全链路（server+扩展）。 */
async function pingExtension(): Promise<boolean> {
  try {
    const res = await fetch(SERVER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {name: 'ping', arguments: {}},
      }),
      signal: AbortSignal.timeout(3000),
    })
    if (!res.ok) return false
    const body = (await res.json()) as {result?: {content?: Array<{text?: string}>}}
    const text = body.result?.content?.[0]?.text ?? ''
    // ping 成功返回 {version, userAgent}
    return text.includes('version') || text.includes('userAgent')
  } catch {
    return false
  }
}

/** 合并 opencode 配置：插入 chrome-in-harness MCP 条目（不覆盖已有同名）。返回新配置对象（纯逻辑）。 */
export function mergeOpencodeConfig(
  existing: Record<string, unknown> | undefined,
  url: string,
): {config: Record<string, unknown>; added: boolean} {
  const base = existing === undefined ? {} : {...existing}
  const currentMcp = base['mcp']
  if (currentMcp !== undefined && !isConfigObject(currentMcp)) {
    throw new Error('OpenCode configuration mcp must be an object; the original file was not changed.')
  }
  const mcp = currentMcp ?? {}
  if (mcp['chrome-in-harness'] !== undefined) return {config: base, added: false}
  return {
    config: {...base, mcp: {...mcp, 'chrome-in-harness': {type: 'remote', url, enabled: true}}},
    added: true,
  }
}

function isConfigObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readOpencodeConfig(configPath: string): Promise<Record<string, unknown>> {
  let raw: string
  try {
    raw = await readFile(configPath, 'utf8')
  } catch (error) {
    if (isConfigObject(error) && error['code'] === 'ENOENT') return {}
    throw new Error(`Cannot read OpenCode configuration at ${configPath}; the original file was not changed.`, {cause: error})
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error(`Invalid JSON in OpenCode configuration at ${configPath}; the original file was not changed.`, {cause: error})
  }
  if (!isConfigObject(parsed)) {
    throw new Error(`OpenCode configuration at ${configPath} must be an object; the original file was not changed.`)
  }
  return parsed
}

/** 往 opencode 全局配置写入 MCP 条目（不覆盖已有同名条目）。 */
export async function writeOpencodeConfig(configPath = path.join(homedir(), '.config', 'opencode', 'opencode.json')): Promise<void> {
  const config = await readOpencodeConfig(configPath)
  const {config: merged, added} = mergeOpencodeConfig(config, SERVER_URL)
  if (!added) {
    log('  opencode 配置已包含 chrome-in-harness，跳过。')
    return
  }
  await mkdir(path.dirname(configPath), {recursive: true})
  await writeFile(configPath, `${JSON.stringify(merged, null, 2)}\n`, {encoding: 'utf8', mode: 0o600})
  log(`  已写入 opencode 全局配置: ${configPath}`)
}

async function doctor(): Promise<void> {
  log('chrome-in-harness doctor')
  log('=======================')
  const running = await isServerRunning()
  log(running ? `[✓] server 已在运行 (${SERVER_URL})` : '[✗] server 未运行')
  if (running) {
    const ok = await pingExtension()
    log(ok ? '[✓] 扩展已连接（ping 通过）' : '[✗] 扩展未连接（请确认已加载 Chrome 扩展）')
  }
  await detectClients()
  log('\n下一步：')
  log('  1. npx @chrome-in-harness/launcher start    # 启动 server')
  log('  2. 在 Chrome 加载扩展（chrome://extensions → 开发者模式 → 加载已解压）')
  log('  3. npx @chrome-in-harness/launcher doctor   # 复检全链路')
}

async function start(): Promise<void> {
  if (await isServerRunning()) {
    log(`server 已在运行：${SERVER_URL}`)
    await writeOpencodeConfig()
    log('如扩展已加载，直接在客户端里调 ping 即可。')
    return
  }
  log('启动 chrome-in-harness server …')

  // 解析 @chrome-in-harness/server 的入口文件（npm 依赖解析，无需硬编码路径）
  let bin: string
  try {
    bin = fileURLToPath(import.meta.resolve('@chrome-in-harness/server'))
  } catch {
    log('未找到 @chrome-in-harness/server，请先安装依赖：npm i @chrome-in-harness/server')
    process.exit(1)
  }

  log(`使用入口: ${bin}`)
  await writeOpencodeConfig()

  const child = spawn(process.execPath, [bin], {
    stdio: 'inherit',
    env: {...process.env, WS_PORT: String(WS_PORT), HTTP_PORT: String(HTTP_PORT)},
  })
  child.on('exit', (code) => {
    log(`\nserver 已退出 (code ${code ?? '?'})`)
    process.exit(code ?? 0)
  })
  log('server 启动中。Ctrl-C 停止。')
}

export async function runCli(): Promise<void> {
  const cmd = parseArgs(process.argv)
  if (cmd === 'start') await start()
  else if (cmd === 'doctor') await doctor()
  else {
    log('chrome-in-harness — 通过 Chrome 扩展控制真实 Chrome profile 的浏览器 MCP')
    log('')
    log('用法：')
    log('  npx @chrome-in-harness/launcher doctor   # 环境自检')
    log('  npx @chrome-in-harness/launcher start    # 启动 server 并写入 MCP 配置')
    log('')
    log('扩展安装：chrome://extensions → 开发者模式 → 加载已解压的扩展程序')
    log('  （从 GitHub Releases 下载 chrome-in-harness-extension.zip，或本仓库 packages/extension/.output/chrome-mv3）')
  }
}
