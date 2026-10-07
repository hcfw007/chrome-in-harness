import {describe, expect, test} from 'vitest'
import {buildWeakScanScript, flattenDomElements, mapWeakCandidates, parseWeakScanResult} from './weak-interactive.js'

describe('buildWeakScanScript', () => {
  test('produces a read-only IIFE scanning cursor/onclick in document order', () => {
    const script = buildWeakScanScript()
    expect(script.trimStart().startsWith('(() =>')).toBe(true)
    expect(script).toContain('cursor === \'pointer\'')
    expect(script).toContain('el.onclick')
    expect(script).toContain('querySelectorAll')
    // 不含任何写操作（内部扫描也保持只读纪律）
    for (const banned of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'execCommand', 'fetch(']) {
      expect(script).not.toContain(banned)
    }
  })
})

describe('parseWeakScanResult', () => {
  test('keeps well-formed entries and skips junk', () => {
    const parsed = parseWeakScanResult([
      {index: 3, tag: 'DIV', text: 'Python3'},
      {index: 'x', tag: 'li'},
      null,
      'junk',
      {index: 9, tag: 'span', text: 42},
    ])
    expect(parsed).toEqual([
      {index: 3, tag: 'div', text: 'Python3'},
      {index: 9, tag: 'span', text: ''},
    ])
  })

  test('non-array input yields empty list', () => {
    expect(parseWeakScanResult(undefined)).toEqual([])
    expect(parseWeakScanResult({})).toEqual([])
  })
})

describe('flattenDomElements', () => {
  test('pre-order walk collects element nodes with backendNodeId and lowercased tag', () => {
    const root = {
      backendNodeId: 1,
      nodeName: 'HTML',
      children: [
        {backendNodeId: 2, nodeName: 'HEAD', children: []},
        {
          backendNodeId: 3,
          nodeName: 'BODY',
          children: [
            {backendNodeId: 4, nodeName: 'DIV', children: [{backendNodeId: 5, nodeName: '#text'}]},
            {nodeName: 'Comment', children: []}, // 无 backendNodeId：跳过
          ],
        },
      ],
      shadowRoots: [{backendNodeId: 6, nodeName: '#document-fragment', children: []}],
    }
    const elements = flattenDomElements(root)
    // shadow fragment 本身不是可点目标，不收集；其子元素照常按文档序收集
    expect(elements.map((e) => e.backendNodeId)).toEqual([1, 2, 3, 4])
    expect(elements.find((e) => e.backendNodeId === 4)?.tag).toBe('div')
  })
})

describe('mapWeakCandidates', () => {
  const elements = [
    {backendNodeId: 100, tag: 'html'},
    {backendNodeId: 101, tag: 'body'},
    {backendNodeId: 102, tag: 'div'},
    {backendNodeId: 103, tag: 'li'},
  ]

  test('aligns by document-order index and keeps first info per backend id', () => {
    const map = mapWeakCandidates(elements, [
      {index: 2, tag: 'div', text: 'Python3'},
      {index: 3, tag: 'li', text: 'Java'},
    ])
    expect(map.get(102)).toEqual({tag: 'div', text: 'Python3'})
    expect(map.get(103)).toEqual({tag: 'li', text: 'Java'})
    expect(map.size).toBe(2)
  })

  test('drops candidates whose index is out of range or tag mismatches (iframe safety)', () => {
    const map = mapWeakCandidates(elements, [
      {index: 99, tag: 'div', text: 'gone'},
      {index: 2, tag: 'span', text: 'wrong tag'},
    ])
    expect(map.size).toBe(0)
  })
})
