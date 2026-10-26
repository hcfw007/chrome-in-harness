import {describe, expect, test} from 'vitest'
import {
  buildFindOptionScript,
  buildNativeSelectFn,
  parseFindOptionReceipt,
  parseNativeSelectReceipt,
} from './option-locate.js'

describe('option scripts embed the option text as a JSON literal', () => {
  const hostile = '"); alert(1); ("'

  test('find-option script', () => {
    const script = buildFindOptionScript(hostile)
    expect(script).toContain(`const needle = ${JSON.stringify(hostile)}`)
    expect(script).not.toContain('alert(1); ("\n')
  })

  test('native select fn', () => {
    expect(buildNativeSelectFn(hostile)).toContain(`const needle = ${JSON.stringify(hostile)}`)
  })
})

describe('parseFindOptionReceipt', () => {
  test('accepts a found option with a finite point', () => {
    expect(parseFindOptionReceipt({kind: 'found', text: '销售', x: 10, y: 20})).toEqual({kind: 'found', text: '销售', x: 10, y: 20})
  })

  test('reports an option that is covered by another element', () => {
    expect(parseFindOptionReceipt({kind: 'covered', text: '销售'})).toEqual({kind: 'covered', text: '销售'})
  })

  test('rejects a found receipt without a usable point', () => {
    expect(parseFindOptionReceipt({kind: 'found', text: 'a', x: 'nope', y: 1})).toBeNull()
    expect(parseFindOptionReceipt({kind: 'found', text: 'a', x: Number.NaN, y: 1})).toBeNull()
  })

  test('keeps only string option labels on a miss', () => {
    expect(parseFindOptionReceipt({kind: 'none', count: 3, options: ['a', 1, 'b']})).toEqual({
      kind: 'none', count: 3, options: ['a', 'b'],
    })
  })

  test('returns null for malformed input', () => {
    expect(parseFindOptionReceipt(null)).toBeNull()
    expect(parseFindOptionReceipt({kind: 'other'})).toBeNull()
  })
})

describe('parseNativeSelectReceipt', () => {
  test('maps each kind', () => {
    expect(parseNativeSelectReceipt({kind: 'not-native'})).toEqual({kind: 'not-native'})
    expect(parseNativeSelectReceipt({kind: 'ok', text: 'B'})).toEqual({kind: 'ok', text: 'B'})
    expect(parseNativeSelectReceipt({kind: 'disabled', text: 'C'})).toEqual({kind: 'disabled', text: 'C'})
    expect(parseNativeSelectReceipt({kind: 'none', options: ['A']})).toEqual({kind: 'none', options: ['A']})
    expect(parseNativeSelectReceipt(undefined)).toBeNull()
  })
})
