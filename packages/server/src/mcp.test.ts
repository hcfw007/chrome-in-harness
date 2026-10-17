import {readFileSync} from 'node:fs'
import {expect, test} from 'vitest'
import {SERVER_VERSION} from './mcp.js'

test('SERVER_VERSION reports the package.json version', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {version: string}
  expect(SERVER_VERSION).toBe(manifest.version)
})
