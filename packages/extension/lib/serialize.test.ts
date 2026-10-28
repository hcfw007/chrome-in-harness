import {describe, expect, test} from 'vitest'
import {MAX_RESULT_JSON, serializeValue} from './serialize.js'

describe('serializeValue', () => {
  test('handles primitives', () => {
    expect(serializeValue(undefined)).toEqual({value: 'undefined', type: 'undefined', truncated: false})
    expect(serializeValue(null)).toEqual({value: 'null', type: 'object', truncated: false})
    expect(serializeValue('hi')).toEqual({value: 'hi', type: 'string', truncated: false})
    expect(serializeValue(42)).toEqual({value: '42', type: 'number', truncated: false})
    expect(serializeValue(true)).toEqual({value: 'true', type: 'boolean', truncated: false})
  })

  test('serializes objects as JSON', () => {
    expect(serializeValue({a: 1})).toEqual({value: '{"a":1}', type: 'object', truncated: false})
  })

  test('keeps multi-KB strings intact (same cap as objects)', () => {
    const text = `BEGIN-${'a'.repeat(5000)}-END`
    expect(serializeValue(text)).toEqual({value: text, type: 'string', truncated: false})
  })

  test('truncates strings over the cap and reports the original length', () => {
    const result = serializeValue('x'.repeat(MAX_RESULT_JSON + 10))
    expect(result.truncated).toBe(true)
    expect(result.originalLength).toBe(MAX_RESULT_JSON + 10)
    expect(result.value).toBe(`${'x'.repeat(MAX_RESULT_JSON)}…`)
  })

  test('truncates oversized objects and reports the JSON length', () => {
    const result = serializeValue({text: 'y'.repeat(MAX_RESULT_JSON)})
    expect(result.truncated).toBe(true)
    expect(result.originalLength).toBe(MAX_RESULT_JSON + 11)
  })

  test('falls back to String() on circular structures', () => {
    const circular: Record<string, unknown> = {}
    circular['self'] = circular
    const result = serializeValue(circular)
    expect(result.truncated).toBe(false)
    expect(result.value.length).toBeGreaterThan(0)
  })
})
