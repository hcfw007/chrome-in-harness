import {describe, expect, test} from 'vitest'
import {hostMatchesRule, isUrlAllowed, normalizeDomainRules, normalizeHostRule} from './site-filter.js'

describe('normalizeHostRule', () => {
  test('accepts bare domains and normalizes case', () => {
    expect(normalizeHostRule('example.com')).toEqual({ok: true, rule: 'example.com'})
    expect(normalizeHostRule('  EXAMPLE.com ')).toEqual({ok: true, rule: 'example.com'})
  })

  test('strips scheme, path and port when users paste a URL', () => {
    expect(normalizeHostRule('https://example.com/a/b')).toEqual({ok: true, rule: 'example.com'})
    expect(normalizeHostRule('http://localhost:3000')).toEqual({ok: true, rule: 'localhost'})
  })

  test('treats the *. prefix as sugar for the bare domain', () => {
    expect(normalizeHostRule('*.example.com')).toEqual({ok: true, rule: 'example.com'})
  })

  test('rejects junk', () => {
    expect(normalizeHostRule('').ok).toBe(false)
    expect(normalizeHostRule('*.').ok).toBe(false)
    expect(normalizeHostRule('https://').ok).toBe(false)
    expect(normalizeHostRule('not a host').ok).toBe(false)
    expect(normalizeHostRule('999.1.1.1').ok).toBe(false)
  })

  test('accepts IPv4 literals exactly', () => {
    expect(normalizeHostRule('127.0.0.1')).toEqual({ok: true, rule: '127.0.0.1'})
  })
})

describe('normalizeDomainRules', () => {
  test('skips blank lines and keeps valid rules', () => {
    const result = normalizeDomainRules('example.com\n\n  Wikipedia.org \n')
    expect(result).toEqual({ok: true, rules: ['example.com', 'wikipedia.org']})
  })

  test('collects every error without polluting valid lines', () => {
    const result = normalizeDomainRules('example.com\nnot a host\n999.9.9.9')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors).toHaveLength(2)
  })
})

describe('hostMatchesRule', () => {
  test('matches the domain itself and any-depth subdomains', () => {
    expect(hostMatchesRule('example.com', 'example.com')).toBe(true)
    expect(hostMatchesRule('a.b.example.com', 'example.com')).toBe(true)
  })

  test('does not match lookalikes', () => {
    expect(hostMatchesRule('notexample.com', 'example.com')).toBe(false)
    expect(hostMatchesRule('example.com.evil.com', 'example.com')).toBe(false)
  })
})

describe('isUrlAllowed', () => {
  const rules = ['example.com', '127.0.0.1']

  test('allows listed domains and their subdomains', () => {
    expect(isUrlAllowed('https://example.com/', rules)).toBe(true)
    expect(isUrlAllowed('https://docs.example.com/page', rules)).toBe(true)
    expect(isUrlAllowed('http://127.0.0.1:8080/', rules)).toBe(true)
  })

  test('is case-insensitive on the host', () => {
    expect(isUrlAllowed('https://EXAMPLE.com/', rules)).toBe(true)
  })

  test('rejects unlisted hosts and lookalikes', () => {
    expect(isUrlAllowed('https://wikipedia.org/', rules)).toBe(false)
    expect(isUrlAllowed('https://example.com.evil.com/', rules)).toBe(false)
  })

  test('rejects host-less and internal URLs always', () => {
    expect(isUrlAllowed('about:blank', rules)).toBe(false)
    expect(isUrlAllowed('chrome://extensions/', rules)).toBe(false)
    expect(isUrlAllowed('chrome-extension://abc/popup.html', rules)).toBe(false)
  })

  test('an empty allowlist rejects everything', () => {
    expect(isUrlAllowed('https://example.com/', [])).toBe(false)
  })
})
