import {ping} from './ping'

export type ToolHandler = (params: unknown) => unknown | Promise<unknown>

const registry = new Map<string, ToolHandler>()

/** 新工具以后往这里加 register。 */
export function register(name: string, handler: ToolHandler): void {
  if (registry.has(name)) {
    throw new Error(`Tool "${name}" is already registered`)
  }
  registry.set(name, handler)
}

export async function dispatch(name: string, params: unknown): Promise<unknown> {
  const handler = registry.get(name)
  if (handler === undefined) {
    throw new Error(`Unknown tool "${name}"`)
  }
  return handler(params)
}

register('ping', ping)
