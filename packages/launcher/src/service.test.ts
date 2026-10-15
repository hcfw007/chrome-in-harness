import {mkdtemp, rm, readFile, writeFile, mkdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {describe, expect, test, vi} from 'vitest'
import {parseArgs} from './cli.js'
import {
  buildLaunchdPlist,
  buildSystemdUnit,
  installService,
  launchdPlistPath,
  systemdUnitPath,
  uninstallService,
} from './service.js'

describe('parseArgs service commands', () => {
  test('recognizes service install/uninstall/status', () => {
    expect(parseArgs(['node', 'cli.js', 'service', 'install'])).toEqual({service: 'install'})
    expect(parseArgs(['node', 'cli.js', 'service', 'uninstall'])).toEqual({service: 'uninstall'})
    expect(parseArgs(['node', 'cli.js', 'service', 'status'])).toEqual({service: 'status'})
  })

  test('falls back to help for missing or unknown service actions', () => {
    expect(parseArgs(['node', 'cli.js', 'service'])).toBe('help')
    expect(parseArgs(['node', 'cli.js', 'service', 'bogus'])).toBe('help')
  })
})

describe('service file paths and content', () => {
  test('paths live under the given home directory', () => {
    expect(launchdPlistPath('/Users/demo')).toBe(
      '/Users/demo/Library/LaunchAgents/com.chrome-in-harness.server.plist',
    )
    expect(systemdUnitPath('/home/demo')).toBe(
      '/home/demo/.config/systemd/user/chrome-in-harness.service',
    )
  })

  test('launchd plist keeps the server alive and wires ports and logs', () => {
    const plist = buildLaunchdPlist({
      nodeBin: '/usr/local/bin/node',
      serverEntry: '/opt/server/dist/index.js',
      logFile: '/Users/demo/Library/Logs/chrome-in-harness-server.log',
      wsPort: 8765,
      httpPort: 12306,
    })
    expect(plist).toContain('<key>Label</key><string>com.chrome-in-harness.server</string>')
    expect(plist).toContain('<key>ProgramArguments</key>')
    expect(plist).toContain('<string>/usr/local/bin/node</string>')
    expect(plist).toContain('<string>/opt/server/dist/index.js</string>')
    expect(plist).toContain('<key>RunAtLoad</key><true/>')
    expect(plist).toContain('<key>KeepAlive</key><true/>')
    expect(plist).toContain('<key>WS_PORT</key><integer>8765</integer>')
    expect(plist).toContain('<key>HTTP_PORT</key><integer>12306</integer>')
    expect(plist).toContain('<string>/Users/demo/Library/Logs/chrome-in-harness-server.log</string>')
  })

  test('systemd user unit restarts always and starts at login', () => {
    const unit = buildSystemdUnit({
      nodeBin: '/usr/bin/node',
      serverEntry: '/opt/server/dist/index.js',
      wsPort: 8765,
      httpPort: 12306,
    })
    expect(unit).toContain('Description=chrome-in-harness local MCP server')
    expect(unit).toContain('ExecStart=/usr/bin/node /opt/server/dist/index.js')
    expect(unit).toContain('Environment=WS_PORT=8765')
    expect(unit).toContain('Environment=HTTP_PORT=12306')
    expect(unit).toContain('Restart=always')
    expect(unit).toContain('WantedBy=default.target')
  })
})

interface Harness {
  home: string
  ran: Array<{file: string; args: string[]}>
  run: ReturnType<typeof vi.fn>
}

async function makeHome(prefix: string): Promise<Harness> {
  const home = await mkdtemp(path.join(tmpdir(), prefix))
  const ran: Harness['ran'] = []
  const run = vi.fn(async (file: string, args: string[]) => {
    ran.push({file, args})
    return {code: 0, stdout: '', stderr: ''}
  })
  return {home, ran, run}
}

describe('installService', () => {
  test('darwin writes the plist and loads it', async () => {
    const h = await makeHome('svc-darwin-')
    try {
      await installService({
        platform: 'darwin',
        home: h.home,
        nodeBin: '/usr/local/bin/node',
        serverEntry: '/opt/server/dist/index.js',
        run: h.run,
      })
      const plist = await readFile(launchdPlistPath(h.home), 'utf8')
      expect(plist).toContain('<key>KeepAlive</key><true/>')
      expect(h.ran).toEqual([
        {file: 'launchctl', args: ['load', launchdPlistPath(h.home)]},
      ])
    } finally {
      await rm(h.home, {recursive: true, force: true})
    }
  })

  test('linux writes the user unit and enables it', async () => {
    const h = await makeHome('svc-linux-')
    try {
      await installService({
        platform: 'linux',
        home: h.home,
        nodeBin: '/usr/bin/node',
        serverEntry: '/opt/server/dist/index.js',
        run: h.run,
      })
      const unit = await readFile(systemdUnitPath(h.home), 'utf8')
      expect(unit).toContain('Restart=always')
      expect(h.ran).toEqual([
        {file: 'systemctl', args: ['--user', 'daemon-reload']},
        {file: 'systemctl', args: ['--user', 'enable', '--now', 'chrome-in-harness.service']},
      ])
    } finally {
      await rm(h.home, {recursive: true, force: true})
    }
  })

  test('darwin refuses to overwrite an existing install and runs nothing', async () => {
    const h = await makeHome('svc-dup-')
    try {
      await mkdir(path.dirname(launchdPlistPath(h.home)), {recursive: true})
      await writeFile(launchdPlistPath(h.home), '<existing/>')
      await expect(
        installService({
          platform: 'darwin',
          home: h.home,
          nodeBin: '/n',
          serverEntry: '/s',
          run: h.run,
        }),
      ).rejects.toThrow(/already installed|uninstall/i)
      expect(h.ran).toEqual([])
      expect(await readFile(launchdPlistPath(h.home), 'utf8')).toBe('<existing/>')
    } finally {
      await rm(h.home, {recursive: true, force: true})
    }
  })

  test('darwin removes the plist again when launchctl load fails', async () => {
    const h = await makeHome('svc-fail-')
    const run = vi.fn(async () => ({code: 1, stdout: '', stderr: 'boom'}))
    try {
      await expect(
        installService({
          platform: 'darwin',
          home: h.home,
          nodeBin: '/n',
          serverEntry: '/s',
          run,
        }),
      ).rejects.toThrow(/launchctl load failed/i)
      await expect(readFile(launchdPlistPath(h.home), 'utf8')).rejects.toThrow(/ENOENT/)
    } finally {
      await rm(h.home, {recursive: true, force: true})
    }
  })

  test('unsupported platforms fail fast', async () => {
    const h = await makeHome('svc-win-')
    try {
      await expect(
        installService({
          platform: 'win32',
          home: h.home,
          nodeBin: '/n',
          serverEntry: '/s',
          run: h.run,
        }),
      ).rejects.toThrow(/not supported/i)
      expect(h.ran).toEqual([])
    } finally {
      await rm(h.home, {recursive: true, force: true})
    }
  })
})

describe('uninstallService', () => {
  test('darwin unloads best-effort and removes the plist', async () => {
    const h = await makeHome('svc-un-')
    try {
      await mkdir(path.dirname(launchdPlistPath(h.home)), {recursive: true})
      await writeFile(launchdPlistPath(h.home), '<plist/>')
      const run = vi.fn(async () => ({code: 1, stdout: '', stderr: 'not loaded'}))
      await uninstallService({platform: 'darwin', home: h.home, run})
      expect(run).toHaveBeenCalledWith('launchctl', ['unload', launchdPlistPath(h.home)])
      await expect(readFile(launchdPlistPath(h.home), 'utf8')).rejects.toThrow(/ENOENT/)
    } finally {
      await rm(h.home, {recursive: true, force: true})
    }
  })

  test('darwin without an install is a no-op that does not run commands', async () => {
    const h = await makeHome('svc-noop-')
    try {
      await uninstallService({platform: 'darwin', home: h.home, run: h.run})
      expect(h.ran).toEqual([])
    } finally {
      await rm(h.home, {recursive: true, force: true})
    }
  })

  test('linux disables the unit, removes the file and reloads the daemon', async () => {
    const h = await makeHome('svc-unlinux-')
    try {
      await mkdir(path.dirname(systemdUnitPath(h.home)), {recursive: true})
      await writeFile(systemdUnitPath(h.home), '[Unit]')
      await uninstallService({platform: 'linux', home: h.home, run: h.run})
      expect(h.ran).toEqual([
        {file: 'systemctl', args: ['--user', 'disable', '--now', 'chrome-in-harness.service']},
        {file: 'systemctl', args: ['--user', 'daemon-reload']},
      ])
      await expect(readFile(systemdUnitPath(h.home), 'utf8')).rejects.toThrow(/ENOENT/)
    } finally {
      await rm(h.home, {recursive: true, force: true})
    }
  })
})
