/**
 * verbatim 输入计划器（纯逻辑，零依赖）。
 * 逐行 insertText + 行间 Enter（触发编辑器自动缩进）+ Shift+Home+Delete 抹掉缩进——
 * 文本（含前导空白/换行/纯空白行）逐字原样还原，不做任何 trim 类处理。
 */

export type VerbatimStep = {kind: 'text'; value: string} | {kind: 'newline'}

/** 把原文拆成可执行步骤：非空行 → text；行间 → newline。前导/尾随换行全部保留。 */
export function planVerbatim(text: string): readonly VerbatimStep[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const steps: VerbatimStep[] = []
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? ''
    if (line.length > 0) steps.push({kind: 'text', value: line})
    if (i < lines.length - 1) steps.push({kind: 'newline'})
  }
  return steps
}
