import {describe, expect, test} from 'vitest'
import {mergeOpencodeConfig, parseArgs} from './cli.js'

describe('parseArgs', () => {
  test('defaults to help', () => {
    expect(parseArgs(['node', 'cli.js'])).toBe('help')
    expect(parseArgs(['node', 'cli.js', 'bogus'])).toBe('help')
  })

  test('recognizes start and doctor', () => {
    expect(parseArgs(['node', 'cli.js', 'start'])).toBe('start')
    expect(parseArgs(['node', 'cli.js', 'doctor'])).toBe('doctor')
  })
})

describe('mergeOpencodeConfig', () => {
  const URL = 'http://127.0.0.1:12306/mcp'

  test('adds the mcp entry to an empty config', () => {
    const {config, added} = mergeOpencodeConfig(undefined, URL)
    expect(added).toBe(true)
    expect(config).toEqual({mcp: {'chrome-in-harness': {type: 'remote', url: URL, enabled: true}}})
  })

  test('preserves existing keys and mcp entries', () => {
    const existing = {model: 'foo', mcp: {other: {type: 'remote', url: 'x'}}}
    const {config, added} = mergeOpencodeConfig(existing, URL)
    expect(added).toBe(true)
    const mcp = config['mcp'] as Record<string, unknown>
    expect(mcp['other']).toEqual({type: 'remote', url: 'x'})
    expect(mcp['chrome-in-harness']).toEqual({type: 'remote', url: URL, enabled: true})
    expect(config['model']).toBe('foo')
  })

  test('does not mutate the existing configuration or its mcp entries', () => {
    const existing = {model: 'foo', mcp: {other: {type: 'remote', url: 'x'}}}
    const before = structuredClone(existing)
    mergeOpencodeConfig(existing, URL)
    expect(existing).toEqual(before)
  })

  test.each([null, [], 'invalid'].map((mcp) => [mcp]))('rejects an invalid mcp section: %j', (mcp) => {
    expect(() => mergeOpencodeConfig({mcp}, URL)).toThrow(/mcp.*object/i)
  })

  test('does not overwrite an existing entry', () => {
    const existing = {mcp: {'chrome-in-harness': {type: 'local', command: ['x']}}}
    const {config, added} = mergeOpencodeConfig(existing, URL)
    expect(added).toBe(false)
    const mcp = config['mcp'] as Record<string, unknown>
    expect(mcp['chrome-in-harness']).toEqual({type: 'local', command: ['x']})
  })
})
