import {describe, expect, test} from 'vitest'
import {hostToMatchPattern, normalizeDomainForPermission, originsForHost} from './permission-grant.js'

describe('hostToMatchPattern', () => {
  test('builds an http/https wildcard match pattern with subdomains', () => {
    expect(hostToMatchPattern('example.com')).toBe('*://example.com/*')
  })
})

describe('originsForHost', () => {
  test('returns exactly one origin per host', () => {
    expect(originsForHost('example.com')).toEqual(['*://example.com/*'])
  })
})

describe('normalizeDomainForPermission', () => {
  test('normalizes and strips scheme/port', () => {
    expect(normalizeDomainForPermission('https://EXAMPLE.com:8080/a')).toEqual({
      ok: true,
      host: 'example.com',
    })
  })

  test('rejects junk', () => {
    expect(normalizeDomainForPermission('not a host').ok).toBe(false)
    expect(normalizeDomainForPermission('').ok).toBe(false)
  })
})
