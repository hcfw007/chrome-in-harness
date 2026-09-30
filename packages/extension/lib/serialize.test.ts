import {describe, expect, test} from 'vitest'
import {serializeValue} from './serialize.js'

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

  test('truncates long strings', () => {
    const result = serializeValue('x'.repeat(2000))
    expect(result.truncated).toBe(true)
    expect(result.value.length).toBeLessThan(2000)
  })

  test('falls back to String() on circular structures', () => {
    const circular: Record<string, unknown> = {}
    circular['self'] = circular
    const result = serializeValue(circular)
    expect(result.truncated).toBe(false)
    expect(result.value.length).toBeGreaterThan(0)
  })
})
