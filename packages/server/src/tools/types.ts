/**
 * 工具装配层类型：server 侧只负责「声明工具 → 调桥 → 格式化结果」，
 * 参数/结果 schema 的唯一真源在 @cic/protocol。
 */
import type {ToolName} from '@cic/protocol'
import type {z, ZodRawShape} from 'zod'

/** 对 WsBridge.sendToExtension 的抽象，测试时用 fake 替换。 */
export type BridgeCall = (tool: string, params: unknown) => Promise<unknown>

export type ToolContent =
  | {type: 'text'; text: string}
  | {type: 'image'; data: string; mimeType: string}

export interface ToolDef {
  readonly name: ToolName
  readonly title: string
  readonly description: string
  readonly schema: ZodRawShape
  run(args: unknown, call: BridgeCall): Promise<ToolContent[]>
}

/** 类型化声明：run 收到的 args 已按 schema 推断。 */
export function defineTool<S extends ZodRawShape>(def: {
  name: ToolName
  title: string
  description: string
  schema: S
  run(args: z.infer<z.ZodObject<S>>, call: BridgeCall): Promise<ToolContent[]>
}): ToolDef {
  return def as ToolDef
}

export function toolText(text: string): ToolContent[] {
  return [{type: 'text', text}]
}

export function toolImage(data: string, mimeType: string): ToolContent[] {
  return [{type: 'image', data, mimeType}]
}

export function formatError(error: unknown): ToolContent[] {
  const message = error instanceof Error ? error.message : String(error)
  return toolText(`Error: ${message}`)
}

/**
 * 调桥并按 result schema 二次校验。WS 返回值是 unknown（边界输入），
 * 解析失败直接 throw，由统一错误路径变成 isError。
 */
export async function callBridge<S extends ZodRawShape>(
  call: BridgeCall,
  tool: string,
  params: unknown,
  resultSchema: z.ZodObject<S>,
): Promise<z.infer<z.ZodObject<S>>> {
  const raw = await call(tool, params)
  return resultSchema.parse(raw)
}
