import {describe, expect, test} from 'vitest'
import {isAllowedExtensionOrigin} from './origin-guard.js'

const EXTENSION_ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop'

describe('isAllowedExtensionOrigin', () => {
  test('accepts any chrome-extension origin when no id is pinned', () => {
    expect(isAllowedExtensionOrigin(EXTENSION_ORIGIN)).toBe(true)
  })

  test('rejects a web page origin', () => {
    expect(isAllowedExtensionOrigin('https://evil.example.com')).toBe(false)
  })

  test('rejects a localhost page origin', () => {
    expect(isAllowedExtensionOrigin('http://localhost:3000')).toBe(false)
  })

  test('rejects a missing origin', () => {
    expect(isAllowedExtensionOrigin(undefined)).toBe(false)
  })

  test('rejects an origin that only embeds the scheme in its path', () => {
    expect(isAllowedExtensionOrigin('https://evil.example.com/chrome-extension://x')).toBe(false)
  })

  test('rejects a chrome-extension origin with a trailing path segment', () => {
    expect(isAllowedExtensionOrigin(`${EXTENSION_ORIGIN}/popup.html`)).toBe(false)
  })

  test('accepts the pinned extension id', () => {
    expect(
      isAllowedExtensionOrigin(EXTENSION_ORIGIN, {
        allowedExtensionId: 'abcdefghijklmnopabcdefghijklmnop',
      }),
    ).toBe(true)
  })

  test('rejects a different extension id when one is pinned', () => {
    expect(
      isAllowedExtensionOrigin(EXTENSION_ORIGIN, {allowedExtensionId: 'someotherextensionid'}),
    ).toBe(false)
  })

  test('treats an empty pinned id as unset', () => {
    expect(isAllowedExtensionOrigin(EXTENSION_ORIGIN, {allowedExtensionId: ''})).toBe(true)
  })
})
