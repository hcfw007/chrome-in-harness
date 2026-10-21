import {describe, expect, test} from 'vitest'
import {buildScrollToScript, parseScrollToReceipt} from './scroll-locate.js'

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

  test('scripts never write to the DOM or touch the network', () => {
    for (const script of [buildScrollToScript({selector: 'a'}), buildScrollToScript({text: 'a'})]) {
      for (const banned of ['innerHTML', '.click(', 'fetch(', 'location']) {
        expect(script).not.toContain(banned)
      }
    }
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
