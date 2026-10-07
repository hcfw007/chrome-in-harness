import {describe, expect, test} from 'vitest'
import type {RefEntry} from './ref-store.js'
import {formatSuggestions, nameSimilarity, suggestSimilarRefs} from './ref-suggest.js'

function entry(ref: string, role: string, name: string): RefEntry {
  return {ref, backendDOMNodeId: Number(ref.slice(1)), role, name, frameId: undefined}
}

describe('nameSimilarity', () => {
  test('exact > containment > shared words > none', () => {
    expect(nameSimilarity('Submit', 'Submit')).toBeGreaterThan(nameSimilarity('Submit', 'Submit code'))
    expect(nameSimilarity('Submit', 'Submit code')).toBeGreaterThan(nameSimilarity('sub task', 'sub-way'))
    expect(nameSimilarity('sub task', 'sub-way')).toBeGreaterThan(nameSimilarity('foo', 'bar'))
    expect(nameSimilarity('foo', 'bar')).toBe(0)
    expect(nameSimilarity('', 'anything')).toBe(0)
  })

  test('is case-insensitive and trims', () => {
    expect(nameSimilarity('  SUBMIT ', 'submit')).toBe(5)
  })
})

describe('suggestSimilarRefs', () => {
  test('ranks same-role + similar-name candidates first and caps the list', () => {
    const entries = [
      entry('e1', 'button', 'Run'),
      entry('e2', 'button', 'Submit'),
      entry('e3', 'link', 'Submit a request'),
      entry('e4', 'textbox', 'Search'),
      entry('e5', 'button', 'Sub'),
    ]
    const suggestions = suggestSimilarRefs({role: 'button', name: 'Submit'}, entries, 3)
    expect(suggestions.map((s) => s.ref)).toEqual(['e2', 'e5', 'e3'])
  })

  test('returns nothing when nothing resembles the lost element', () => {
    const entries = [entry('e1', 'textbox', 'Search')]
    expect(suggestSimilarRefs({role: 'button', name: 'Payment'}, entries)).toEqual([])
  })
})

describe('formatSuggestions', () => {
  test('renders a hint line or empty string', () => {
    expect(formatSuggestions([])).toBe('')
    const text = formatSuggestions([{ref: 'e2', role: 'button', name: 'Submit'}])
    expect(text).toContain('e2 \'Submit\' (button)')
  })
})
