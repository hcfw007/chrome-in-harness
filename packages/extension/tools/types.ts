/** 扩展侧工具实现签名：params 已由 protocol schema 校验，返回值原样作为 WS result。 */
export type ToolHandler = (params: unknown) => unknown | Promise<unknown>
