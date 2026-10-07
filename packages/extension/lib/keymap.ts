/**
 * 键名 → CDP Input.dispatchKeyEvent 参数映射（纯逻辑，零 chrome.* 依赖）。
 * 接受功能键名（Enter/Backspace/…）与单字符（a、A、!、空格）；
 * modifiers 用 CDP 位掩码：Alt=1 Ctrl=2 Meta=4 Shift=8。
 */

export type InputModifier = 'ctrl' | 'alt' | 'shift' | 'meta'

const MODIFIER_BITS: Record<InputModifier, number> = {
  alt: 1,
  ctrl: 2,
  meta: 4,
  shift: 8,
}

export function modifierBitmask(modifiers: readonly InputModifier[] | undefined): number {
  let mask = 0
  for (const m of modifiers ?? []) mask |= MODIFIER_BITS[m] ?? 0
  return mask
}

export interface KeyDispatch {
  /** CDP key 参数（KeyboardEvent.key）。 */
  readonly key: string
  /** CDP code 参数（KeyboardEvent.code）。 */
  readonly code: string
  readonly windowsVirtualKeyCode: number
  /** 有值 = 该键会产生字符输入（keyDown 用 text 事件而非 rawKeyDown）。 */
  readonly text: string | undefined
}

interface NamedKey {
  readonly code: string
  readonly keyCode: number
  readonly key?: string
  /** 有值 = 按键随字符事件（Enter 的 '\r' 是换行真正生效的通道）。 */
  readonly text?: string
}

/** 功能键表：key 名与键名相同（除个别别名）。 */
const NAMED_KEYS: Record<string, NamedKey> = {
  Enter: {code: 'Enter', keyCode: 13, text: '\r'},
  Return: {code: 'Enter', keyCode: 13, key: 'Enter', text: '\r'},
  Tab: {code: 'Tab', keyCode: 9},
  Backspace: {code: 'Backspace', keyCode: 8},
  Delete: {code: 'Delete', keyCode: 46},
  Del: {code: 'Delete', keyCode: 46, key: 'Delete'},
  Escape: {code: 'Escape', keyCode: 27},
  Esc: {code: 'Escape', keyCode: 27, key: 'Escape'},
  Space: {code: 'Space', keyCode: 32, key: ' '},
  ArrowUp: {code: 'ArrowUp', keyCode: 38},
  ArrowDown: {code: 'ArrowDown', keyCode: 40},
  ArrowLeft: {code: 'ArrowLeft', keyCode: 37},
  ArrowRight: {code: 'ArrowRight', keyCode: 39},
  Up: {code: 'ArrowUp', keyCode: 38, key: 'ArrowUp'},
  Down: {code: 'ArrowDown', keyCode: 40, key: 'ArrowDown'},
  Left: {code: 'ArrowLeft', keyCode: 37, key: 'ArrowLeft'},
  Right: {code: 'ArrowRight', keyCode: 39, key: 'ArrowRight'},
  Home: {code: 'Home', keyCode: 36},
  End: {code: 'End', keyCode: 35},
  PageUp: {code: 'PageUp', keyCode: 33},
  PageDown: {code: 'PageDown', keyCode: 34},
  Insert: {code: 'Insert', keyCode: 45},
}

for (let i = 1; i <= 12; i += 1) {
  NAMED_KEYS[`F${i}`] = {code: `F${i}`, keyCode: 111 + i}
}

/** US 键盘标点的 shift 变体：无 shift 字符 → {code, keyCode, shiftChar}。 */
const PUNCTUATION: Record<string, {code: string; keyCode: number; shiftChar: string}> = {
  ';': {code: 'Semicolon', keyCode: 186, shiftChar: ':'},
  '=': {code: 'Equal', keyCode: 187, shiftChar: '+'},
  ',': {code: 'Comma', keyCode: 188, shiftChar: '<'},
  '-': {code: 'Minus', keyCode: 189, shiftChar: '_'},
  '.': {code: 'Period', keyCode: 190, shiftChar: '>'},
  '/': {code: 'Slash', keyCode: 191, shiftChar: '?'},
  '`': {code: 'Backquote', keyCode: 192, shiftChar: '~'},
  '[': {code: 'BracketLeft', keyCode: 219, shiftChar: '{'},
  '\\': {code: 'Backslash', keyCode: 220, shiftChar: '|'},
  ']': {code: 'BracketRight', keyCode: 221, shiftChar: '}'},
  '\'': {code: 'Quote', keyCode: 222, shiftChar: '"'},
}

/** shift 位符号（数字行与标点 shift 变体）→ 基键信息。 */
const SHIFTED: Record<string, {code: string; keyCode: number; baseChar: string}> = (() => {
  const table: Record<string, {code: string; keyCode: number; baseChar: string}> = {
    '!': {code: 'Digit1', keyCode: 49, baseChar: '1'},
    '@': {code: 'Digit2', keyCode: 50, baseChar: '2'},
    '#': {code: 'Digit3', keyCode: 51, baseChar: '3'},
    $: {code: 'Digit4', keyCode: 52, baseChar: '4'},
    '%': {code: 'Digit5', keyCode: 53, baseChar: '5'},
    '^': {code: 'Digit6', keyCode: 54, baseChar: '6'},
    '&': {code: 'Digit7', keyCode: 55, baseChar: '7'},
    '*': {code: 'Digit8', keyCode: 56, baseChar: '8'},
    '(': {code: 'Digit9', keyCode: 57, baseChar: '9'},
    ')': {code: 'Digit0', keyCode: 48, baseChar: '0'},
  }
  for (const [base, def] of Object.entries(PUNCTUATION)) {
    table[def.shiftChar] = {code: def.code, keyCode: def.keyCode, baseChar: base}
  }
  return table
})()

export type ResolveKeyOk = {ok: true; info: KeyDispatch}
export type ResolveKeyErr = {ok: false; error: string}

/** 解析键名输入；单字符按 US 键盘推断 code/keyCode 与 shift 变体。 */
export function resolveKey(input: string): ResolveKeyOk | ResolveKeyErr {
  if (input.length === 0) return {ok: false, error: 'key must not be empty'}

  const named = NAMED_KEYS[input]
  if (named !== undefined) {
    return {
      ok: true,
      info: {
        key: named.key ?? input,
        code: named.code,
        windowsVirtualKeyCode: named.keyCode,
        text: named.text,
      },
    }
  }

  // 控制字符（模型偶尔会把 \b\r 当按键发）：按语义映射而非字面插入
  if (input === '\b') {
    return {ok: true, info: {key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, text: undefined}}
  }
  if (input === '\r' || input === '\n') {
    return {ok: true, info: {key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: undefined}}
  }
  if (input === '\t') {
    return {ok: true, info: {key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, text: undefined}}
  }

  if (input.length === 1) {
    const ch = input
    if (ch === ' ') {
      return {ok: true, info: {key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' '}}
    }
    const lower = ch.toLowerCase()
    if (lower >= 'a' && lower <= 'z') {
      const keyCode = ch.toUpperCase().charCodeAt(0)
      const code = `Key${ch.toUpperCase()}`
      // 纯字母 shift 只改大小写；带 ctrl/alt/meta 时无字符输入（由调用方按 modifiers 决定 text）
      return {
        ok: true,
        info: {key: ch, code, windowsVirtualKeyCode: keyCode, text: ch},
      }
    }
    if (ch >= '0' && ch <= '9') {
      return {ok: true, info: {key: ch, code: `Digit${ch}`, windowsVirtualKeyCode: ch.charCodeAt(0), text: ch}}
    }
    const punct = PUNCTUATION[ch]
    if (punct !== undefined) {
      return {ok: true, info: {key: ch, code: punct.code, windowsVirtualKeyCode: punct.keyCode, text: ch}}
    }
    const shifted = SHIFTED[ch]
    if (shifted !== undefined) {
      return {ok: true, info: {key: ch, code: shifted.code, windowsVirtualKeyCode: shifted.keyCode, text: ch}}
    }
    // 其余 Unicode 字符（中文、emoji 等）：无标准 code，走 text 输入
    if (ch.codePointAt(0)! > 0x20) {
      return {ok: true, info: {key: ch, code: '', windowsVirtualKeyCode: 0, text: ch}}
    }
  }

  const examples = 'Enter, Backspace, Delete, Escape, Tab, ArrowUp/Down/Left/Right, Home, End, PageUp, PageDown, Insert, F1-F12, Space, or a single character'
  return {ok: false, error: `unknown key "${input}". Valid examples: ${examples}`}
}

/** 无 shift 字符 → shift 后字符（字母大写；数字行与标点按 US 键盘）。 */
const SHIFT_VARIANT: ReadonlyMap<string, string> = (() => {
  const table = new Map<string, string>()
  for (const [shiftedChar, def] of Object.entries(SHIFTED)) {
    table.set(def.baseChar, shiftedChar)
  }
  return table
})()

/**
 * 组装 keyDown 的最终 text：ctrl/alt/meta 组合键不产生字符输入（否则浏览器会把它
 * 当成字符插入而不是快捷键）；纯 shift 应用 shift 变体（shift+a → "A"）。
 */
export function keyDownText(info: KeyDispatch, modifierMask: number): string | undefined {
  if (info.text === undefined) return undefined
  const nonShiftOnly = modifierMask & ~MODIFIER_BITS.shift
  if (nonShiftOnly !== 0) return undefined
  if ((modifierMask & MODIFIER_BITS.shift) !== 0 && info.key.length === 1) {
    const ch = info.key
    if (ch >= 'a' && ch <= 'z') return ch.toUpperCase()
    return SHIFT_VARIANT.get(ch) ?? info.text
  }
  return info.text
}
