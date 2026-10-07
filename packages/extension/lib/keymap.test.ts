import {describe, expect, test} from 'vitest'
import {keyDownText, modifierBitmask, resolveKey} from './keymap.js'

describe('modifierBitmask', () => {
  test('maps to CDP bits: alt=1 ctrl=2 meta=4 shift=8', () => {
    expect(modifierBitmask(undefined)).toBe(0)
    expect(modifierBitmask([])).toBe(0)
    expect(modifierBitmask(['ctrl'])).toBe(2)
    expect(modifierBitmask(['shift'])).toBe(8)
    expect(modifierBitmask(['alt', 'meta'])).toBe(5)
    expect(modifierBitmask(['ctrl', 'shift', 'alt', 'meta'])).toBe(15)
  })
})

describe('resolveKey', () => {
  test('named keys carry code + virtual key code; Enter carries the \r char event', () => {
    expect(resolveKey('Enter')).toEqual({
      ok: true,
      info: {key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r'},
    })
    expect(resolveKey('Backspace')!.ok).toBe(true)
    expect(resolveKey('Backspace')).toMatchObject({info: {windowsVirtualKeyCode: 8, text: undefined}})
    expect(resolveKey('Escape')).toMatchObject({info: {windowsVirtualKeyCode: 27}})
    expect(resolveKey('ArrowLeft')).toMatchObject({info: {code: 'ArrowLeft', windowsVirtualKeyCode: 37}})
    expect(resolveKey('Home')).toMatchObject({info: {windowsVirtualKeyCode: 36}})
    expect(resolveKey('End')).toMatchObject({info: {windowsVirtualKeyCode: 35}})
    expect(resolveKey('F12')).toMatchObject({info: {windowsVirtualKeyCode: 123}})
  })

  test('aliases resolve to canonical keys', () => {
    expect(resolveKey('Esc')).toMatchObject({info: {key: 'Escape'}})
    expect(resolveKey('Return')).toMatchObject({info: {key: 'Enter'}})
    expect(resolveKey('Del')).toMatchObject({info: {key: 'Delete'}})
    expect(resolveKey('Up')).toMatchObject({info: {key: 'ArrowUp'}})
  })

  test('letters map to Key<Letter> codes with char text', () => {
    expect(resolveKey('a')).toEqual({ok: true, info: {key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, text: 'a'}})
    expect(resolveKey('A')).toEqual({ok: true, info: {key: 'A', code: 'KeyA', windowsVirtualKeyCode: 65, text: 'A'}})
  })

  test('digits, punctuation and shifted symbols map correctly', () => {
    expect(resolveKey('5')).toMatchObject({info: {code: 'Digit5', windowsVirtualKeyCode: 53}})
    expect(resolveKey(';')).toMatchObject({info: {code: 'Semicolon', windowsVirtualKeyCode: 186}})
    expect(resolveKey(':')).toMatchObject({info: {code: 'Semicolon', windowsVirtualKeyCode: 186}})
    expect(resolveKey('!')).toMatchObject({info: {code: 'Digit1', windowsVirtualKeyCode: 49}})
    expect(resolveKey('(')).toMatchObject({info: {code: 'Digit9', windowsVirtualKeyCode: 57}})
  })

  test('space and control characters resolve semantically', () => {
    expect(resolveKey(' ')).toMatchObject({info: {key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' '}})
    // \b\r 是字面控制字符：映射为对应按键而不是字面插入（复现路径里的核心痛点）
    expect(resolveKey('\b')).toMatchObject({info: {key: 'Backspace', windowsVirtualKeyCode: 8}})
    expect(resolveKey('\r')).toMatchObject({info: {key: 'Enter', windowsVirtualKeyCode: 13}})
    expect(resolveKey('\n')).toMatchObject({info: {key: 'Enter', windowsVirtualKeyCode: 13}})
    expect(resolveKey('\t')).toMatchObject({info: {key: 'Tab', windowsVirtualKeyCode: 9}})
  })

  test('unknown keys fail with guidance', () => {
    const result = resolveKey('Ctrl+a')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('Valid examples')
    expect(resolveKey('').ok).toBe(false)
  })
})

describe('keyDownText', () => {
  const letter = resolveKey('a')
  const upperA = resolveKey('A')
  const semi = resolveKey(';')

  test('ctrl/alt/meta combos drop text so the chord is not inserted as a char', () => {
    if (!letter.ok || !upperA.ok || !semi.ok) throw new Error('resolveKey failed')
    expect(keyDownText(letter.info, modifierBitmask(['ctrl']))).toBeUndefined()
    expect(keyDownText(letter.info, modifierBitmask(['ctrl', 'shift']))).toBeUndefined()
    expect(keyDownText(letter.info, modifierBitmask(['meta']))).toBeUndefined()
    expect(keyDownText(letter.info, modifierBitmask(['alt']))).toBeUndefined()
  })

  test('shift applies the shifted variant', () => {
    if (!letter.ok || !upperA.ok || !semi.ok) throw new Error('resolveKey failed')
    expect(keyDownText(letter.info, modifierBitmask(['shift']))).toBe('A')
    expect(keyDownText(semi.info, modifierBitmask(['shift']))).toBe(':')
  })

  test('plain keys keep their text', () => {
    if (!letter.ok || !upperA.ok) throw new Error('resolveKey failed')
    expect(keyDownText(letter.info, 0)).toBe('a')
    expect(keyDownText(upperA.info, 0)).toBe('A')
    expect(keyDownText(upperA.info, modifierBitmask(['shift']))).toBe('A')
  })

  test('Enter keeps \r for the typed newline; ctrl+Enter drops it (keybinding, not char)', () => {
    const enter = resolveKey('Enter')
    if (!enter.ok) throw new Error('resolveKey failed')
    expect(keyDownText(enter.info, 0)).toBe('\r')
    expect(keyDownText(enter.info, modifierBitmask(['shift']))).toBe('\r')
    expect(keyDownText(enter.info, modifierBitmask(['ctrl']))).toBeUndefined()
  })
})
