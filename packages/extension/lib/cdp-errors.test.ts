import {describe, expect, test} from 'vitest'
import {isStaleNodeError} from './cdp-errors.js'

describe('isStaleNodeError', () => {
  test('matches the three CDP stale-node messages', () => {
    expect(isStaleNodeError(new Error('No node with given id'))).toBe(true)
    expect(isStaleNodeError(new Error('Node is detached from document'))).toBe(true)
    expect(
      isStaleNodeError(new Error('Node with given id does not belong to the document')),
    ).toBe(true)
  })

  test('matches when the message is embedded in a larger CDP payload', () => {
    expect(
      isStaleNodeError(
        new Error('{"code":-32000,"message":"Node is detached from document"}'),
      ),
    ).toBe(true)
  })

  test('accepts non-Error inputs via String()', () => {
    expect(isStaleNodeError('Node is detached from document')).toBe(true)
    expect(isStaleNodeError({message: 'No node with given id'})).toBe(false)
  })

  test('does not misfire on unrelated errors', () => {
    expect(isStaleNodeError(new Error('Cannot find context with specified id'))).toBe(false)
    expect(isStaleNodeError(new Error('Target closed'))).toBe(false)
    expect(isStaleNodeError(undefined)).toBe(false)
  })
})
