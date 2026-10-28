/**
 * type / press_key 的目标绑定与错误语义回归（多 iframe 终端场景）。
 * CDP 层以桩替换：记录真实派发的输入（insertText / dispatchKey / dispatchClick），
 * 断言「拒绝时一个字都没发」以及报文对已发内容的描述与实际一致。
 */
import {beforeEach, describe, expect, test, vi} from 'vitest'
import {NotFocusableError, NotRenderedError} from '../lib/input-errors'

vi.mock('./access', () => ({
  authorizeTab: async (tabId?: number) => ({tabId: tabId ?? 1, url: 'https://x.test/'}),
  toolError: (code: string, message: string) => new Error(`${code}: ${message}`),
}))
vi.mock('../lib/cdp', () => ({ensureAttached: async () => {}}))
vi.mock('./snapshot', () => ({snapshot: async () => ({})}))

/** 每个用例可改写的页面状态。 */
const page = {
  scrollError: undefined as Error | undefined,
  focusError: undefined as Error | undefined,
  deepFocused: true,
  focusInFrame: true,
  covered: false,
  focus: {tag: 'textarea', editable: true, monaco: false, insertionPoint: null, crossOrigin: false, frame: 'iframe[0] "A" https://x.test/a'},
  focusAfter: undefined as Record<string, unknown> | undefined,
  sent: [] as string[],
}

vi.mock('../lib/cdp-commands', () => ({
  callOnNode: async () => (page.covered ? {kind: 'covered', tag: 'iframe'} : {kind: 'clear'}),
  clearFocusedNativeValue: async () => false,
  describeNodeRect: async () => ({}),
  dispatchClick: async () => { page.sent.push('click') },
  dispatchHover: async () => {},
  dispatchKey: async (_t: number, info: {key: string}) => { page.sent.push(`key:${info.key}`) },
  dispatchWheel: async () => {},
  elementCenter: async () => ({x: 10, y: 10}),
  ensureFocusEmulation: async () => {},
  ensureKeyPipelineAlive: async () => {},
  evaluateJson: async () => null,
  focusNode: async () => { if (page.focusError) throw page.focusError },
  getViewportMetrics: async () => ({width: 800, height: 600, dpr: 1}),
  insertText: async (_t: number, text: string) => { page.sent.push(`text:${text}`) },
  isFocusInNodeFrame: async () => page.focusInFrame,
  isNodeDeepFocused: async () => page.deepFocused,
  monacoSetValue: async () => ({kind: 'no-monaco'}),
  readFocusedValue: async () => null,
  readInputFocus: async () => (page.sent.some((s) => s.startsWith('text:')) && page.focusAfter ? page.focusAfter : page.focus),
  scrollIntoViewIfNeeded: async () => { if (page.scrollError) throw page.scrollError },
  viewportCenter: async () => ({x: 0, y: 0}),
}))

vi.mock('./ref-recovery', () => ({
  withRef: async (_tabId: number, _ref: string, fn: (entry: {backendDOMNodeId: number}) => Promise<unknown>) =>
    fn({backendDOMNodeId: 7}),
}))

const {pressKey, typeText} = await import('./interact.js')

beforeEach(() => {
  page.scrollError = undefined
  page.focusError = undefined
  page.deepFocused = true
  page.focusInFrame = true
  page.covered = false
  page.focusAfter = undefined
  page.focus = {tag: 'textarea', editable: true, monaco: false, insertionPoint: null, crossOrigin: false, frame: 'iframe[0] "A" https://x.test/a'}
  page.sent = []
})

const NONE_SENT = /^INPUT_NOT_LANDED: .*No input was sent\./

describe('type(ref, focus:"none") 拒绝不可输入的目标，且不发任何输入', () => {
  test('隐藏（display:none）', async () => {
    page.scrollError = new NotRenderedError('x')
    await expect(typeText({ref: 'e1', focus: 'none', text: 'MARKER', submit: true})).rejects.toThrow(NONE_SENT)
    expect(page.sent).toEqual([])
  })

  test('disabled（DOM.focus 报 not focusable）', async () => {
    page.focusError = new NotFocusableError('x')
    await expect(typeText({ref: 'e1', focus: 'none', text: 'MARKER', submit: true})).rejects.toThrow(
      /^INPUT_NOT_LANDED: e1 cannot receive focus .*No input was sent\./,
    )
    expect(page.sent).toEqual([])
  })

  test('DOM.focus 不报错但焦点留在别的 iframe', async () => {
    page.deepFocused = false
    await expect(typeText({ref: 'e1', focus: 'none', text: 'MARKER', submit: true})).rejects.toThrow(
      /^INPUT_NOT_LANDED: e1 did not receive focus .*No input was sent\./,
    )
    expect(page.sent).toEqual([])
  })

  test('STALE_REF 等已带码的错误原样透出', async () => {
    page.scrollError = new Error('STALE_REF: ref e1 belongs to an older snapshot')
    await expect(typeText({ref: 'e1', focus: 'none', text: 'MARKER'})).rejects.toThrow(/^STALE_REF:/)
    expect(page.sent).toEqual([])
  })
})

describe('type(ref) 默认点击路径', () => {
  test('隐藏目标：点击前拒绝，未发送', async () => {
    page.scrollError = new NotRenderedError('x')
    await expect(typeText({ref: 'e1', text: 'MARKER'})).rejects.toThrow(NONE_SENT)
    expect(page.sent).toEqual([])
  })

  test('点击后焦点进了别的 frame：报「点击已发、未输入」，不打字', async () => {
    page.focusInFrame = false
    await expect(typeText({ref: 'e1', text: 'MARKER', submit: true})).rejects.toThrow(
      /^INPUT_NOT_LANDED: after clicking e1, focus is in a different frame.*A focusing click was dispatched, but no text or keys were sent\./,
    )
    expect(page.sent).toEqual(['click'])
  })

  test('disabled 目标：点击后焦点不在可编辑元素，报「点击已发」', async () => {
    page.focus = {...page.focus, tag: 'body', editable: false, frame: null as unknown as string}
    await expect(typeText({ref: 'e1', text: 'MARKER'})).rejects.toThrow(/A focusing click was dispatched/)
    expect(page.sent).toEqual(['click'])
  })

  test('正常路径：点击 → 文本 → Enter，并回报落点 frame', async () => {
    const result = await typeText({ref: 'e1', text: 'MARKER', submit: true})
    expect(page.sent).toEqual(['click', 'text:MARKER', 'key:Enter'])
    expect(result).toMatchObject({frame: 'iframe[0] "A" https://x.test/a'})
  })
})

describe('输入已发出后的失败不能声称「未发送」', () => {
  test('打字过程中焦点离开：报 Input WAS sent', async () => {
    page.focusAfter = {...page.focus, tag: 'body', editable: false}
    const error = (await Promise.resolve()
      .then(() => typeText({ref: 'e1', focus: 'none', text: 'MARKER'}))
      .catch((e: unknown) => e)) as Error
    expect(error.message).toMatch(/^INPUT_NOT_LANDED: focus left the editable/)
    expect(error.message).toContain('Input WAS sent')
    expect(error.message).not.toContain('No input was sent')
    expect(page.sent).toEqual(['text:MARKER'])
  })
})

describe('type 不带 ref：按实际焦点输入（兼容行为不变）', () => {
  test('焦点可编辑：输入并回报实际落点 frame', async () => {
    page.focus = {...page.focus, frame: 'iframe[1] "B" https://x.test/b'}
    const result = await typeText({focus: 'none', text: 'hostname'})
    expect(page.sent).toEqual(['text:hostname'])
    expect(result).toMatchObject({frame: 'iframe[1] "B" https://x.test/b'})
  })

  test('焦点不可编辑：拒绝并建议传 ref', async () => {
    page.focus = {...page.focus, tag: 'body', editable: false}
    await expect(typeText({focus: 'none', text: 'x'})).rejects.toThrow(/No input was sent\. Pass the ref of the target input/)
    expect(page.sent).toEqual([])
  })
})

describe('press_key(ref) 与 type 同一目标校验', () => {
  test('ref 没拿到焦点：不按键', async () => {
    page.deepFocused = false
    await expect(pressKey({ref: 'e1', key: 'Enter'})).rejects.toThrow(NONE_SENT)
    expect(page.sent).toEqual([])
  })

  test('disabled：不按键', async () => {
    page.focusError = new NotFocusableError('x')
    await expect(pressKey({ref: 'e1', key: 'Enter'})).rejects.toThrow(NONE_SENT)
    expect(page.sent).toEqual([])
  })
})
