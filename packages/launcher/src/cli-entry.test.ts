import {execFileSync} from 'node:child_process'
import {readFileSync} from 'node:fs'
import {mkdtemp, rm, symlink} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {expect, test} from 'vitest'

test('runs the installed CLI through a symlink in a path containing spaces', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url))
  const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
    bin: {'chrome-in-harness': string}
  }
  const directory = await mkdtemp(path.join(tmpdir(), 'chrome cli-test-'))
  const bin = path.join(directory, 'chrome-in-harness')
  try {
    await symlink(path.join(root, manifest.bin['chrome-in-harness']), bin)
    const output = execFileSync(process.execPath, [bin, 'help'], {encoding: 'utf8', timeout: 5000})
    expect(output).toContain('chrome-in-harness')
    expect(output).toContain('用法')
  } finally {
    await rm(directory, {recursive: true, force: true})
  }
})
