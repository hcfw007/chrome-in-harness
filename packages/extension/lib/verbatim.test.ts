import {describe, expect, test} from 'vitest'
import {planVerbatim} from './verbatim.js'

function render(steps: ReadonlyArray<ReturnType<typeof planVerbatim>[number]>): string {
  // 模拟执行器：text → 原样字符；newline → '\n'（缩进抹除后为空）
  return steps.map((s) => (s.kind === 'text' ? s.value : '\n')).join('')
}

describe('planVerbatim', () => {
  test('普通多行文本逐行拆分', () => {
    expect(planVerbatim('a\nb')).toEqual([{kind: 'text', value: 'a'}, {kind: 'newline'}, {kind: 'text', value: 'b'}])
  })

  test('前导单个换行原样保留（P0-3 case 1）', () => {
    const steps = planVerbatim('\nself.x = 1')
    expect(steps[0]).toEqual({kind: 'newline'})
    expect(steps[1]).toEqual({kind: 'text', value: 'self.x = 1'})
    expect(render(steps)).toBe('\nself.x = 1')
  })

  test('前导双换行原样保留（P0-3 case 2）', () => {
    const steps = planVerbatim('\n\nclass X:')
    expect(steps.slice(0, 2)).toEqual([{kind: 'newline'}, {kind: 'newline'}])
    expect(steps[2]).toEqual({kind: 'text', value: 'class X:'})
    expect(render(steps)).toBe('\n\nclass X:')
  })

  test('前导空格+换行原样保留（P0-3 case 3）', () => {
    const steps = planVerbatim(' \nclass X:')
    expect(steps[0]).toEqual({kind: 'text', value: ' '})
    expect(steps[1]).toEqual({kind: 'newline'})
    expect(steps[2]).toEqual({kind: 'text', value: 'class X:'})
    expect(render(steps)).toBe(' \nclass X:')
  })

  test('纯空白文本（P0-3 case 4）', () => {
    const steps = planVerbatim('  \n \n  ')
    expect(steps).toEqual([
      {kind: 'text', value: '  '},
      {kind: 'newline'},
      {kind: 'text', value: ' '},
      {kind: 'newline'},
      {kind: 'text', value: '  '},
    ])
    expect(render(steps)).toBe('  \n \n  ')
  })

  test('尾随换行保留', () => {
    expect(render(planVerbatim('a\n'))).toBe('a\n')
    expect(render(planVerbatim('a\n\n'))).toBe('a\n\n')
  })

  test('\\r\\n 与 \\r 归一为 \\n', () => {
    expect(render(planVerbatim('a\r\nb\rc'))).toBe('a\nb\nc')
  })

  test('无换行单行不产生 newline 步骤', () => {
    expect(planVerbatim('hello')).toEqual([{kind: 'text', value: 'hello'}])
  })
})
