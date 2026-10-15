/**
 * 常驻服务安装：把本地 server 注册为登录自启 + 崩溃自动拉起的用户级服务。
 * - macOS：launchd 用户代理（~/Library/LaunchAgents，RunAtLoad + KeepAlive）
 * - Linux：systemd 用户单元（~/.config/systemd/user，Restart=always）
 * 文件生成是纯函数（可单测）；install/uninstall 只做「写文件 + 调系统命令」的薄封装，
 * 系统命令通过 run 注入，测试不打真 launchctl/systemctl。
 */
import {execFile} from 'node:child_process'
import {existsSync} from 'node:fs'
import {mkdir, rm, writeFile} from 'node:fs/promises'
import {homedir} from 'node:os'
import path from 'node:path'
import {promisify} from 'node:util'

const execFileAsync = promisify(execFile)

export type ServicePlatform = 'darwin' | 'linux' | 'win32'
export type Platform = NodeJS.Platform

export const LAUNCHD_LABEL = 'com.chrome-in-harness.server'
export const SYSTEMD_NAME = 'chrome-in-harness.service'

export interface RunResult {
  code: number
  stdout: string
  stderr: string
}

export type Runner = (file: string, args: string[]) => Promise<RunResult>

export const defaultRunner: Runner = async (file, args) => {
  try {
    const {stdout, stderr} = await execFileAsync(file, args)
    return {code: 0, stdout, stderr}
  } catch (error) {
    const e = error as {code?: number; stdout?: string; stderr?: string; message: string}
    return {code: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? e.message}
  }
}

export function launchdPlistPath(home = homedir()): string {
  return path.join(home, 'Library', 'LaunchAgents', `${LAUNCHD_LABEL}.plist`)
}

export function launchdLogPath(home = homedir()): string {
  return path.join(home, 'Library', 'Logs', 'chrome-in-harness-server.log')
}

export function systemdUnitPath(home = homedir()): string {
  return path.join(home, '.config', 'systemd', 'user', SYSTEMD_NAME)
}

export interface ServiceDefinitionInput {
  readonly nodeBin: string
  readonly serverEntry: string
  readonly wsPort: number
  readonly httpPort: number
}

export function buildLaunchdPlist(input: ServiceDefinitionInput & {logFile: string}): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${input.nodeBin}</string>
    <string>${input.serverEntry}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>WS_PORT</key><integer>${input.wsPort}</integer>
    <key>HTTP_PORT</key><integer>${input.httpPort}</integer>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${input.logFile}</string>
  <key>StandardErrorPath</key><string>${input.logFile}</string>
</dict>
</plist>
`
}

export function buildSystemdUnit(input: ServiceDefinitionInput): string {
  return `[Unit]
Description=chrome-in-harness local MCP server
After=network.target

[Service]
ExecStart=${input.nodeBin} ${input.serverEntry}
Environment=WS_PORT=${input.wsPort}
Environment=HTTP_PORT=${input.httpPort}
Restart=always
RestartSec=2

[Install]
WantedBy=default.target
`
}

function normalizePlatform(platform: NodeJS.Platform): ServicePlatform | 'unsupported' {
  if (platform === 'darwin') return 'darwin'
  if (platform === 'linux') return 'linux'
  return 'unsupported'
}

export interface ServiceOptions {
  readonly platform?: NodeJS.Platform
  readonly home?: string
  readonly run?: Runner
}

export async function installService(
  options: ServiceOptions & {nodeBin: string; serverEntry: string; wsPort: number; httpPort: number},
): Promise<void> {
  const platform = normalizePlatform(options.platform ?? process.platform)
  const run = options.run ?? defaultRunner
  if (platform === 'unsupported') {
    throw new Error(
      `service install is not supported on ${String(options.platform ?? process.platform)}; ` +
        'run "chrome-in-harness start" in a long-lived terminal instead.',
    )
  }
  if (platform === 'darwin') {
    const home = options.home ?? homedir()
    const plist = launchdPlistPath(home)
    if (existsSync(plist)) {
      throw new Error(`service is already installed at ${plist}; run "service uninstall" first.`)
    }
    await mkdir(path.dirname(plist), {recursive: true})
    await writeFile(plist, buildLaunchdPlist({
      nodeBin: options.nodeBin,
      serverEntry: options.serverEntry,
      wsPort: options.wsPort,
      httpPort: options.httpPort,
      logFile: launchdLogPath(home),
    }))
    const result = await run('launchctl', ['load', plist])
    if (result.code !== 0) {
      // 安装半途失败：清掉 plist，回到未安装状态，不留双态。
      await rm(plist, {force: true})
      throw new Error(`launchctl load failed: ${result.stderr.trim()}`)
    }
    return
  }
  const home = options.home ?? homedir()
  const unit = systemdUnitPath(home)
  if (existsSync(unit)) {
    throw new Error(`service is already installed at ${unit}; run "service uninstall" first.`)
  }
  await mkdir(path.dirname(unit), {recursive: true})
  await writeFile(unit, buildSystemdUnit({
    nodeBin: options.nodeBin,
    serverEntry: options.serverEntry,
    wsPort: options.wsPort,
    httpPort: options.httpPort,
  }))
  const reload = await run('systemctl', ['--user', 'daemon-reload'])
  const enable = await run('systemctl', ['--user', 'enable', '--now', SYSTEMD_NAME])
  if (reload.code !== 0 || enable.code !== 0) {
    await rm(unit, {force: true})
    await run('systemctl', ['--user', 'daemon-reload']).catch(() => undefined)
    throw new Error(`systemctl enable failed: ${(enable.stderr || reload.stderr).trim()}`)
  }
}

export async function uninstallService(options: ServiceOptions = {}): Promise<void> {
  const platform = normalizePlatform(options.platform ?? process.platform)
  const run = options.run ?? defaultRunner
  if (platform === 'unsupported') {
    throw new Error(`service uninstall is not supported on ${String(options.platform ?? process.platform)}.`)
  }
  if (platform === 'darwin') {
    const plist = launchdPlistPath(options.home ?? homedir())
    if (!existsSync(plist)) return
    // unload 尽力而为：服务本来没加载也算卸载成功。
    await run('launchctl', ['unload', plist])
    await rm(plist, {force: true})
    return
  }
  const unit = systemdUnitPath(options.home ?? homedir())
  if (!existsSync(unit)) return
  await run('systemctl', ['--user', 'disable', '--now', SYSTEMD_NAME])
  await rm(unit, {force: true})
  await run('systemctl', ['--user', 'daemon-reload'])
}
