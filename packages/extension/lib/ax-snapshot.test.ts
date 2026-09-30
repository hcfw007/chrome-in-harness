import {describe, expect, test} from 'vitest'
import {renderAxSnapshot} from './ax-snapshot'
import {parseAxNodes} from './ax-types'
import type {AxNode} from './ax-types'

type MutableAxNode = Omit<AxNode, 'childIds' | 'ignored'> & {childIds: string[]; ignored: boolean}

let nextId = 0

function node(partial: Partial<Omit<AxNode, 'childIds'>> & {childIds?: string[]; nodeId?: string}): MutableAxNode {
  nextId += 1
  const id = partial.nodeId ?? String(nextId)
  return {
    nodeId: id,
    ignored: false,
    role: 'generic',
    name: '',
    value: '',
    childIds: [],
    backendDOMNodeId: undefined,
    frameId: undefined,
    checked: undefined,
    disabled: false,
    expanded: undefined,
    selected: undefined,
    level: undefined,
    clickable: false,
    focusable: false,
    hasPopup: false,
    ...partial,
  }
}

function rawNode(overrides: Record<string, unknown>): unknown {
  return {
    nodeId: String(Math.random()),
    ignored: false,
    role: {type: 'role', value: 'generic'},
    ...overrides,
  }
}

describe('parseAxNodes', () => {
  test('unwraps CDP {type,value} wrappers and properties[]', () => {
    const nodes = parseAxNodes([
      rawNode({
        nodeId: '1',
        role: {type: 'role', value: 'button'},
        name: {type: 'name', value: 'Submit'},
        backendDOMNodeId: 42,
        properties: [
          {name: 'disabled', value: {type: 'boolean', value: true}},
          {name: 'clickable', value: {type: 'boolean', value: true}},
          {name: 'level', value: {type: 'integer', value: 2}},
        ],
        childIds: [],
      }),
    ])
    expect(nodes).toHaveLength(1)
    const n = nodes[0]!
    expect(n.role).toBe('button')
    expect(n.name).toBe('Submit')
    expect(n.backendDOMNodeId).toBe(42)
    expect(n.disabled).toBe(true)
    expect(n.clickable).toBe(true)
    expect(n.level).toBe(2)
  })

  test('skips malformed entries instead of failing', () => {
    const nodes = parseAxNodes([{nope: true}, 'junk', rawNode({nodeId: '7'})])
    expect(nodes).toHaveLength(1)
    expect(nodes[0]!.nodeId).toBe('7')
  })
})

describe('renderAxSnapshot', () => {
  test('renders roles, names, attrs and assigns refs in DFS order', () => {
    const tree = [
      node({nodeId: '0', role: 'RootWebArea', name: 'Example Domain'}),
      node({nodeId: '1', role: 'heading', name: 'Example Domain', level: 1, backendDOMNodeId: 11}),
      node({nodeId: '2', role: 'link', name: 'More information', backendDOMNodeId: 12}),
      node({nodeId: '3', role: 'textbox', name: 'Search', value: 'hello', backendDOMNodeId: 13}),
    ]
    tree[0]!.childIds.push('1', '2', '3')
    const result = renderAxSnapshot(tree)

    expect(result.text).toBe(
      [
        '- RootWebArea "Example Domain"',
        '  - heading "Example Domain" [level=1] [ref=e1]',
        '  - link "More information" [ref=e2]',
        '  - textbox "Search" [ref=e3]: "hello"',
      ].join('\n'),
    )
    expect(result.refs.map((r) => r.ref)).toEqual(['e1', 'e2', 'e3'])
    expect(result.refs[0]).toMatchObject({backendDOMNodeId: 11, role: 'heading'})
    expect(result.truncated).toBe(false)
  })

  test('ignored containers vanish but their semantic children survive (lifted)', () => {
    const tree = [
      node({nodeId: '0', role: 'RootWebArea', name: 'root'}),
      node({nodeId: '1', role: 'generic', name: 'junk'}),
      node({nodeId: '2', role: 'button', name: 'lifted', backendDOMNodeId: 21}),
      node({nodeId: '3', role: 'button', name: 'visible', backendDOMNodeId: 22}),
    ]
    tree[0]!.childIds.push('1', '3')
    tree[1]!.childIds.push('2')
    tree[1]!.ignored = true
    const result = renderAxSnapshot(tree)
    expect(result.text).not.toContain('junk')
    expect(result.text).toContain('lifted')
    expect(result.text).toContain('visible')
    expect(result.refs.map((r) => r.name)).toEqual(['lifted', 'visible'])
  })

  test('ignored leaf nodes disappear entirely', () => {
    const tree = [
      node({nodeId: '0', role: 'RootWebArea', name: 'root'}),
      node({nodeId: '1', role: 'generic', name: 'ghost', backendDOMNodeId: 31}),
      node({nodeId: '2', role: 'button', name: 'real', backendDOMNodeId: 32}),
    ]
    tree[0]!.childIds.push('1', '2')
    tree[1]!.ignored = true
    const result = renderAxSnapshot(tree)
    expect(result.text).not.toContain('ghost')
    expect(result.text).toContain('real')
    expect(result.refs.map((r) => r.name)).toEqual(['real'])
  })

  test('collapses anonymous single-child chains onto one line depth', () => {
    const tree = [
      node({nodeId: '0', role: 'RootWebArea', name: 'root'}),
      node({nodeId: '1', role: 'generic'}),
      node({nodeId: '2', role: 'generic'}),
      node({nodeId: '3', role: 'button', name: 'deep', backendDOMNodeId: 31}),
    ]
    tree[0]!.childIds.push('1')
    tree[1]!.childIds.push('2')
    tree[2]!.childIds.push('3')
    const result = renderAxSnapshot(tree)
    expect(result.text).toBe(['- RootWebArea "root"', '  - button "deep" [ref=e1]'].join('\n'))
  })

  test('ghost containers do not emit lines but keep child indentation', () => {
    const tree = [
      node({nodeId: '0', role: 'RootWebArea', name: 'root'}),
      node({nodeId: '1', role: 'generic'}),
      node({nodeId: '2', role: 'link', name: 'a', backendDOMNodeId: 41}),
      node({nodeId: '3', role: 'link', name: 'b', backendDOMNodeId: 42}),
    ]
    tree[0]!.childIds.push('1')
    tree[1]!.childIds.push('2', '3')
    const result = renderAxSnapshot(tree)
    // 幽灵容器不产行，但子级层级照常 +1（root=0 → ghost=1 → link=2）
    expect(result.text).toBe(
      ['- RootWebArea "root"', '    - link "a" [ref=e1]', '    - link "b" [ref=e2]'].join('\n'),
    )
  })

  test('marks clickable generic nodes as ref candidates', () => {
    const tree = [
      node({nodeId: '0', role: 'RootWebArea', name: 'root'}),
      node({nodeId: '1', role: 'generic', name: 'card', clickable: true, backendDOMNodeId: 51}),
    ]
    tree[0]!.childIds.push('1')
    const result = renderAxSnapshot(tree)
    expect(result.refs).toHaveLength(1)
    expect(result.text).toContain('[ref=e1]')
  })

  test('unnamed clickable generic container survives compaction and gets a ref', () => {
    // 回归：icon-only 操作按钮（如「...」）是无 accessible name 的 clickable 容器，
    // 不能被 isCollapsible/isGhostContainer 吞掉，否则模型只能点到旁边同名/无名节点。
    const tree = [
      node({nodeId: '0', role: 'RootWebArea', name: 'root'}),
      node({nodeId: '1', role: 'generic', clickable: true, backendDOMNodeId: 41}),
      node({nodeId: '2', role: 'generic', clickable: true, backendDOMNodeId: 42}),
      node({nodeId: '3', role: 'button', name: '评论', backendDOMNodeId: 43}),
    ]
    // root 下：无名 clickable 容器(1) 与 评论按钮(3)；容器内还有无名 clickable(2)
    tree[0]!.childIds.push('1', '3')
    tree[1]!.childIds.push('2')
    const result = renderAxSnapshot(tree)
    expect(result.refs.map((r) => r.backendDOMNodeId)).toEqual([41, 42, 43])
    expect(result.text).toContain('[ref=e1]')
    expect(result.text).toContain('[ref=e2]')
  })

  test('non-clickable unnamed generic containers are still compacted', () => {
    const tree = [
      node({nodeId: '0', role: 'RootWebArea', name: 'root'}),
      node({nodeId: '1', role: 'generic'}),
      node({nodeId: '2', role: 'button', name: 'deep', backendDOMNodeId: 51}),
    ]
    tree[0]!.childIds.push('1')
    tree[1]!.childIds.push('2')
    const result = renderAxSnapshot(tree)
    expect(result.text).toBe(['- RootWebArea "root"', '  - button "deep" [ref=e1]'].join('\n'))
  })

  test('unnamed focusable/haspopup icon controls get a ref', () => {
    // 回归：「...」菜单按钮在 AX 里是无名的 image/focusable + aria-haspopup
    const tree = [
      node({nodeId: '0', role: 'RootWebArea', name: 'root'}),
      node({nodeId: '1', role: 'image', focusable: true, hasPopup: true, backendDOMNodeId: 61}),
      node({nodeId: '2', role: 'image', focusable: false, backendDOMNodeId: 62}),
    ]
    tree[0]!.childIds.push('1', '2')
    const result = renderAxSnapshot(tree)
    expect(result.refs.map((r) => r.backendDOMNodeId)).toEqual([61])
  })

  test('depth limit cuts with a marker', () => {
    const tree = [node({nodeId: '0', role: 'RootWebArea', name: 'root'})]
    let parent = '0'
    for (let i = 1; i <= 45; i += 1) {
      const id = String(i)
      tree.push(node({nodeId: id, role: 'group', name: `g${i}`}))
      tree.find((n) => n.nodeId === parent)!.childIds.push(id)
      parent = id
    }
    const result = renderAxSnapshot(tree, {maxDepth: 3})
    expect(result.text).toContain('… [depth limit]')
    expect(result.text).toContain('g3')
    expect(result.text).not.toContain('g4')
  })

  test('character budget sets the truncated flag and footer', () => {
    const tree = [
      node({nodeId: '0', role: 'RootWebArea', name: 'root'}),
      node({nodeId: '1', role: 'paragraph', name: 'x'.repeat(500), backendDOMNodeId: 61}),
      node({nodeId: '2', role: 'paragraph', name: 'y'.repeat(500), backendDOMNodeId: 62}),
    ]
    tree[0]!.childIds.push('1', '2')
    const result = renderAxSnapshot(tree, {maxChars: 200})
    expect(result.truncated).toBe(true)
    expect(result.text).toContain('… [truncated at')
  })

  test('clips long names and values', () => {
    const long = 'x'.repeat(500)
    const tree = [
      node({nodeId: '0', role: 'RootWebArea', name: 'root'}),
      node({nodeId: '1', role: 'textbox', name: long, value: long, backendDOMNodeId: 71}),
    ]
    tree[0]!.childIds.push('1')
    const result = renderAxSnapshot(tree)
    expect(result.text).toContain('x'.repeat(199) + '…')
    expect(result.text.match(/x{500}/)).toBeNull()
  })

  test('is deterministic for identical input', () => {
    const tree = [
      node({nodeId: '0', role: 'RootWebArea', name: 'root'}),
      node({nodeId: '1', role: 'link', name: 'a', backendDOMNodeId: 81}),
    ]
    tree[0]!.childIds.push('1')
    expect(renderAxSnapshot(tree)).toEqual(renderAxSnapshot(tree))
  })
})
