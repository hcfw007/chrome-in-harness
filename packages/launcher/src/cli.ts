#!/usr/bin/env node
/**
 * chrome-in-harness launcher：一条命令完成「检查/引导装扩展 + 起 server + 写 MCP 配置」。
 *
 * 用法：
 *   npx chrome-in-harness           检查环境并给出下一步
 *   npx chrome-in-harness start     启动本地 server（前台，Ctrl-C 退出）
 *   npx chrome-in-harness doctor    完整环境自检
 */

import {spawn} from 'node:child_process'
import {existsSync} from 'node:fs'
import {readFile, writeFile} from 'node:fs/promises'
import net from 'node:net'
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

/** 检测扩展是否已装：通过 MCP tools/ping 验证全链路（server+扩展）。 */
async function pingExtension(): Promise<boolean> {
  try {
    const res = await fetch(SERVER_URL, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({jsonrpc: '2.0', id: 2, method: 'tools/call', params: {name: 'ping', arguments: {}}}),
      signal: AbortSignal.timeout(3000),
    })
    if (!res.ok) return false
    const body = (await res.json()) as {result?: {content?: Array<{text?: string}>}}
    const text = body.result?.content?.[0]?.text ?? ''
    return text.includes('pong') || text.toLowerCase().includes('extension')
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
  base['mcp'] ??= {}
  const mcp = base['mcp'] as Record<string, unknown>
  if (mcp['chrome-in-harness'] !== undefined) return {config: base, added: false}
  mcp['chrome-in-harness'] = {type: 'remote', url, enabled: true}
  return {config: base, added: true}
}

/** 往 opencode 全局配置写入 MCP 条目（不覆盖已有同名条目）。 */
async function writeOpencodeConfig(): Promise<void> {
  const home = process.env['HOME'] ?? ''
  const configPath = path.join(home, '.config', 'opencode', 'opencode.json')
  let config: Record<string, unknown> = {}
  if (existsSync(configPath)) {
    try {
      config = JSON.parse(await readFile(configPath, 'utf8')) as Record<string, unknown>
    } catch {
      config = {}
    }
  }
  const {config: merged, added} = mergeOpencodeConfig(config, SERVER_URL)
  if (!added) {
    log('  opencode 配置已包含 chrome-in-harness，跳过。')
    return
  }
  await writeFile(configPath, `${JSON.stringify(merged, null, 2)}\n`, 'utf8')
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
  log('  1. npx chrome-in-harness start    # 启动 server')
  log('  2. 在 Chrome 加载扩展（chrome://extensions → 开发者模式 → 加载已解压）')
  log('  3. npx chrome-in-harness doctor   # 复检全链路')
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

async function main(): Promise<void> {
  const cmd = parseArgs(process.argv)
  if (cmd === 'start') await start()
  else if (cmd === 'doctor') await doctor()
  else {
    log('chrome-in-harness — 通过 Chrome 扩展控制真实 Chrome profile 的浏览器 MCP')
    log('')
    log('用法：')
    log('  npx chrome-in-harness doctor   # 环境自检')
    log('  npx chrome-in-harness start    # 启动 server 并写入 MCP 配置')
    log('')
    log('扩展安装：chrome://extensions → 开发者模式 → 加载已解压的扩展程序')
    log('  （从 GitHub Releases 下载 chrome-in-harness.zip，或本仓库 packages/extension/.output/chrome-mv3）')
  }
}

// 仅在作为 CLI 入口执行时运行；被测试 import 时不启动。
if (process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((error: unknown) => {
    console.error(`launcher failed: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  })
}
