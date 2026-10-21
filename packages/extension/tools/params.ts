/**
 * handler 入口参数校验：run_actions 步骤 params 是 record<unknown>，不经 server 侧 zod，
 * 凡会把参数拼进页面脚本的工具都必须在这里按协议 schema 再校验一次，而不是直接 cast。
 */
import type {z} from 'zod'

export function parseToolParams<S extends z.ZodTypeAny>(tool: string, schema: S, params: unknown): z.infer<S> {
  const result = schema.safeParse(params)
  if (result.success) return result.data as z.infer<S>
  const {issues} = result.error
  // 仅有 refine 文案（如「pass exactly one of …」）时原样透出，保持与 server 侧一致
  if (issues.every((issue) => issue.code === 'custom')) {
    throw new Error(issues.map((issue) => issue.message).join('; '))
  }
  const detail = issues
    .map((issue) => `${issue.path.length > 0 ? issue.path.join('.') : '(root)'}: ${issue.message}`)
    .join('; ')
  throw new Error(`${tool}: invalid params — ${detail}`)
}
