import {describe, expect, test} from 'vitest'
import {buildWeakScanScript, flattenDomElements, mapWeakCandidates, parseWeakScanResult} from './weak-interactive.js'

describe('buildWeakScanScript', () => {
  test('produces a read-only IIFE scanning cursor/onclick in document order', () => {
    const script = buildWeakScanScript()
    expect(script.trimStart().startsWith('(() =>')).toBe(true)
    expect(script).toContain('cursor === \'pointer\'')
    expect(script).toContain('el.onclick')
    expect(script).toContain('querySelectorAll')
    // cursor 继承：只认 pointer 的最外层元素
    expect(script).toContain('parentElement')
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
  const el = (backendNodeId: number, localName: string, children: unknown[] = [], extra = {}) => ({
    backendNodeId,
    nodeType: 1,
    nodeName: localName.toUpperCase(),
    localName,
    children,
    ...extra,
  })

  test('pre-order walk collects element nodes only, with lowercased tag', () => {
    const root = el(1, 'html', [
      el(2, 'head'),
      el(3, 'body', [
        el(4, 'div', [{backendNodeId: 5, nodeType: 3, nodeName: '#text'}]),
        {backendNodeId: 6, nodeType: 8, nodeName: '#comment'},
      ]),
    ])
    const elements = flattenDomElements(root)
    expect(elements.map((e) => e.backendNodeId)).toEqual([1, 2, 3, 4])
    expect(elements.find((e) => e.backendNodeId === 4)?.tag).toBe('div')
  })

  test('keeps SVG elements whose nodeName is lowercase so later indexes stay aligned', () => {
    // 回归：SVG 的 nodeName 是小写 svg/path，旧实现按大写判元素会漏掉，后续序号整体错位
    const svg = {backendNodeId: 10, nodeType: 1, nodeName: 'svg', localName: 'svg', children: [
      {backendNodeId: 11, nodeType: 1, nodeName: 'path', localName: 'path', children: []},
    ]}
    const root = el(1, 'html', [el(2, 'body', [el(3, 'span', [svg]), el(4, 'div')])])
    const elements = flattenDomElements(root)
    expect(elements.map((e) => e.tag)).toEqual(['html', 'body', 'span', 'svg', 'path', 'div'])
  })

  test('does not descend into shadow roots or iframe documents (querySelectorAll does not either)', () => {
    const root = el(1, 'html', [
      el(2, 'body', [
        el(3, 'my-widget', [], {shadowRoots: [{backendNodeId: 30, nodeType: 11, children: [el(31, 'button')]}]}),
        el(4, 'iframe', [], {contentDocument: {backendNodeId: 40, nodeType: 9, children: [el(41, 'html')]}}),
        el(5, 'div'),
      ]),
    ])
    expect(flattenDomElements(root).map((e) => e.backendNodeId)).toEqual([1, 2, 3, 4, 5])
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
