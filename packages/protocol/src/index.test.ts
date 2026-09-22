import {describe, expect, test} from 'vitest'
import {isWsHello, isWsRequest, isWsResponse, parseExtensionMessage} from './index.js'

describe('isWsRequest', () => {
  test('accepts a well-formed request', () => {
    expect(isWsRequest({v: 1, id: 'srv-1', tool: 'ping', params: {}})).toBe(true)
  })

  test('accepts a request whose params are explicitly null', () => {
    expect(isWsRequest({v: 1, id: 'srv-1', tool: 'ping', params: null})).toBe(true)
  })

  test('rejects a request with a mismatched protocol version', () => {
    expect(isWsRequest({v: 2, id: 'srv-1', tool: 'ping', params: {}})).toBe(false)
  })

  test('rejects a request missing the params key', () => {
    expect(isWsRequest({v: 1, id: 'srv-1', tool: 'ping'})).toBe(false)
  })
})

describe('isWsResponse', () => {
  test('accepts a success response carrying a result', () => {
    expect(isWsResponse({v: 1, id: 'srv-1', ok: true, result: {a: 1}})).toBe(true)
  })

  test('accepts an error response carrying a string error', () => {
    expect(isWsResponse({v: 1, id: 'srv-1', ok: false, error: 'boom'})).toBe(true)
  })

  test('rejects an error response whose error is not a string', () => {
    expect(isWsResponse({v: 1, id: 'srv-1', ok: false, error: {code: 1}})).toBe(false)
  })

  test('rejects a response with no ok field', () => {
    expect(isWsResponse({v: 1, id: 'srv-1', result: 1})).toBe(false)
  })
})

describe('isWsHello', () => {
  test('accepts a well-formed hello', () => {
    expect(isWsHello({v: 1, type: 'hello', version: '0.1.0', userAgent: 'UA'})).toBe(true)
  })

  test('rejects a hello missing userAgent', () => {
    expect(isWsHello({v: 1, type: 'hello', version: '0.1.0'})).toBe(false)
  })
})

describe('parseExtensionMessage', () => {
  test('returns the hello when given a hello frame', () => {
    const parsed = parseExtensionMessage(
      JSON.stringify({v: 1, type: 'hello', version: '0.1.0', userAgent: 'UA'}),
    )
    expect(parsed).toMatchObject({type: 'hello', version: '0.1.0'})
  })

  test('returns the response when given a response frame', () => {
    const parsed = parseExtensionMessage(JSON.stringify({v: 1, id: 'srv-1', ok: true, result: 7}))
    expect(parsed).toMatchObject({id: 'srv-1', ok: true, result: 7})
  })

  test('returns undefined for invalid JSON', () => {
    expect(parseExtensionMessage('{not json')).toBeUndefined()
  })

  test('returns undefined for JSON that matches no known frame', () => {
    expect(parseExtensionMessage(JSON.stringify({v: 1, id: 'srv-1'}))).toBeUndefined()
  })
})
