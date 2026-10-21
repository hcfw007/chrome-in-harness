import {describe, expect, test} from 'vitest'
import {
  CENTER_AND_DESCRIBE,
  DESCRIBE_ELEMENT,
  TEXT_CONTROL_SELECTOR,
  buildScrollToScript,
  parseScrollToReceipt,
} from './scroll-locate.js'

describe('buildScrollToScript', () => {
  test('selector mode queries the selector and centers it', () => {
    const script = buildScrollToScript({selector: '.row[data-id="1"]'})
    expect(script).toContain('document.querySelector(".row[data-id=\\"1\\"]")')
    expect(script).toContain('scrollIntoView({block: \'center\'')
  })

  test('text mode walks text nodes and only accepts visible owners', () => {
    const script = buildScrollToScript({text: '导出'})
    expect(script).toContain('createTreeWalker')
    expect(script).toContain('"导出"')
    expect(script).toContain('r.width > 0 && r.height > 0')
  })

  test('text mode climbs to the enclosing control (antd <button><span>text</span></button>)', () => {
    const script = buildScrollToScript({text: '导 出'})
    expect(script).toContain('el.closest(CONTROL) || el')
    expect(TEXT_CONTROL_SELECTOR.split(',')).toEqual(expect.arrayContaining(['button', 'a[href]', '[role="button"]', '[role="option"]']))
    // 不泛匹配 [role]：否则会上溯到 row / region 这类容器
    expect(TEXT_CONTROL_SELECTOR.split(',')).not.toContain('[role]')
  })

  test('scripts never write to the DOM or touch the network', () => {
    for (const script of [buildScrollToScript({selector: 'a'}), buildScrollToScript({text: 'a'})]) {
      for (const banned of ['innerHTML', '.click(', 'fetch(', 'location']) {
        expect(script).not.toContain(banned)
      }
    }
  })
})

describe('CENTER_AND_DESCRIBE (ref mode)', () => {
  test('centers the element like selector/text mode and embeds the real describe function', () => {
    expect(CENTER_AND_DESCRIBE).toContain('scrollIntoView({block: \'center\'')
    expect(CENTER_AND_DESCRIBE).toContain(DESCRIBE_ELEMENT)
    expect(CENTER_AND_DESCRIBE).not.toContain('${')
  })
})

describe('parseScrollToReceipt', () => {
  test('keeps rect / inViewport / tag / text', () => {
    expect(
      parseScrollToReceipt({rect: {x: 1, y: 2, width: 3, height: 4}, inViewport: true, tag: 'li', text: 'Java'}),
    ).toEqual({rect: {x: 1, y: 2, width: 3, height: 4}, inViewport: true, tag: 'li', text: 'Java'})
  })

  test('missing element or malformed payload yields null', () => {
    expect(parseScrollToReceipt(null)).toBeNull()
    expect(parseScrollToReceipt({inViewport: true})).toBeNull()
  })

  test('empty text is dropped and inViewport defaults to false', () => {
    expect(parseScrollToReceipt({rect: {x: 0, y: 0, width: 0, height: 0}, text: ''})).toEqual({
      rect: {x: 0, y: 0, width: 0, height: 0},
      inViewport: false,
    })
  })
})
