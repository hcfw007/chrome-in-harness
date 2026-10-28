import {describe, expect, test} from 'vitest'
import {renderAxSnapshot} from './ax-snapshot'
import {mergeFrameAxTrees} from './ax-types'
import type {AxNode} from './ax-types'

function node(partial: Partial<AxNode> & {nodeId: string}): AxNode {
  return {
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

/** 主 frame：页面根 + 两个终端 iframe（JumpServer 多会话）。 */
const main: AxNode[] = [
  node({nodeId: '1', role: 'RootWebArea', name: 'multi', childIds: ['2', '3'], backendDOMNodeId: 10}),
  node({nodeId: '2', role: 'Iframe', name: 'runner-2', backendDOMNodeId: 11}),
  node({nodeId: '3', role: 'Iframe', name: 'runner-4', backendDOMNodeId: 12}),
]

/** 各 frame 的 AX nodeId 独立编号，故意与主 frame 重号。 */
function terminalFrame(frameId: string, owner: number, inputBackend: number) {
  return {
    frameId,
    ownerBackendNodeId: owner,
    nodes: [
      node({nodeId: '1', role: 'RootWebArea', name: 'term', childIds: ['2'], backendDOMNodeId: inputBackend - 1}),
      node({nodeId: '2', role: 'textbox', name: 'terminal input', backendDOMNodeId: inputBackend, focusable: true}),
    ],
  }
}

describe('mergeFrameAxTrees', () => {
  test('嫁接子 frame 到宿主 iframe 下，重号 nodeId 加前缀去重', () => {
    const merged = mergeFrameAxTrees(main, [terminalFrame('FA', 11, 101), terminalFrame('FB', 12, 201)])
    const ids = merged.map((n) => n.nodeId)
    expect(new Set(ids).size).toBe(ids.length)
    expect(merged.find((n) => n.nodeId === '2')?.childIds).toEqual(['FA:1'])
    expect(merged.find((n) => n.nodeId === 'FB:2')).toMatchObject({backendDOMNodeId: 201, frameId: 'FB'})
  })

  test('合并后 snapshot 能为 iframe 内的输入框分配 ref', () => {
    const merged = mergeFrameAxTrees(main, [terminalFrame('FA', 11, 101), terminalFrame('FB', 12, 201)])
    const render = renderAxSnapshot(merged)
    expect(render.refs.map((r) => r.backendDOMNodeId)).toEqual([101, 201])
    expect(render.text).toContain('runner-2')
    expect(render.text).toContain('terminal input')
  })

  test('嵌套 iframe：父 frame 在前时子 frame 能找到宿主', () => {
    const outer = {
      frameId: 'FO',
      ownerBackendNodeId: 11,
      nodes: [
        node({nodeId: '1', role: 'RootWebArea', childIds: ['2'], backendDOMNodeId: 300}),
        node({nodeId: '2', role: 'Iframe', backendDOMNodeId: 301}),
      ],
    }
    const merged = mergeFrameAxTrees(main, [outer, terminalFrame('FI', 301, 401)])
    expect(merged.find((n) => n.nodeId === 'FO:2')?.childIds).toEqual(['FI:1'])
  })

  test('找不到宿主或子树为空的 frame 被丢弃，主树不变', () => {
    const merged = mergeFrameAxTrees(main, [terminalFrame('FX', 999, 501), {frameId: 'FE', ownerBackendNodeId: 11, nodes: []}])
    expect(merged).toEqual(main)
  })
})
