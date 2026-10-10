import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {afterEach, beforeEach, describe, expect, test} from 'vitest'
import {writeOpencodeConfig} from './cli.js'

let home: string
let configPath: string

beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), 'chrome-config-test-'))
  configPath = path.join(home, '.config', 'opencode', 'opencode.json')
})

afterEach(async () => {
  await rm(home, {recursive: true, force: true})
})

describe('writeOpencodeConfig', () => {
  test('creates the configuration directory on first use', async () => {
    await writeOpencodeConfig(configPath)
    const config = JSON.parse(await readFile(configPath, 'utf8'))
    expect(config.mcp['chrome-in-harness'].url).toBe('http://127.0.0.1:12306/mcp')
  })

  test.each(['{broken', 'null', '[]', '{"mcp":null}', '{"mcp":[]}'])('preserves invalid configuration: %s', async (original) => {
    await mkdir(path.dirname(configPath), {recursive: true})
    await writeFile(configPath, original)
    await expect(writeOpencodeConfig(configPath)).rejects.toThrow(/configuration|mcp/i)
    expect(await readFile(configPath, 'utf8')).toBe(original)
  })

  test('preserves an existing same-name entry byte for byte', async () => {
    const original = '{"mcp":{"chrome-in-harness":{"type":"local","command":["x"]}}}'
    await mkdir(path.dirname(configPath), {recursive: true})
    await writeFile(configPath, original)
    await writeOpencodeConfig(configPath)
    expect(await readFile(configPath, 'utf8')).toBe(original)
  })

  test('does not replace an unreadable configuration path', async () => {
    await mkdir(configPath, {recursive: true})
    await expect(writeOpencodeConfig(configPath)).rejects.toThrow(/configuration/i)
  })
})
