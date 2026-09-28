/** 把全部工具注册进 McpServer：统一的错误路径与 schema 装配。 */
import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js'
import {BROWSER_TOOL_DEFS} from './defs-browser.js'
import {TAB_TOOL_DEFS} from './defs-tabs.js'
import {formatError} from './types.js'
import type {BridgeCall, ToolContent, ToolDef} from './types.js'

const ALL_TOOL_DEFS: readonly ToolDef[] = [...TAB_TOOL_DEFS, ...BROWSER_TOOL_DEFS]

function toResult(
  content: ToolContent[],
  isError = false,
): {content: ToolContent[]; isError?: boolean} {
  return isError ? {content, isError: true} : {content}
}

export function registerAllTools(server: McpServer, call: BridgeCall): void {
  for (const def of ALL_TOOL_DEFS) {
    server.registerTool(
      def.name,
      {title: def.title, description: def.description, inputSchema: def.schema},
      async (args: unknown) => {
        try {
          return toResult(await def.run(args, call))
        } catch (error) {
          return toResult(formatError(error), true)
        }
      },
    )
  }
}
