import { createServer } from "node:http";
import { handleMcpRequest } from "./mcp.js";
import { WsBridge } from "./ws-bridge.js";

const WS_PORT = Number(process.env["WS_PORT"] ?? 8765);
const HTTP_PORT = Number(process.env["HTTP_PORT"] ?? 12306);

function startHttpServer(wsBridge: WsBridge): void {
  const httpServer = createServer((req, res) => {
    const path = req.url?.split("?")[0] ?? "";
    if (path !== "/mcp") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found. MCP endpoint is at /mcp" }));
      return;
    }
    handleMcpRequest(req, res, wsBridge).catch((error: unknown) => {
      console.error(`[mcp] unhandled error: ${error instanceof Error ? error.message : error}`);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal server error" }));
      }
    });
  });
  httpServer.listen(HTTP_PORT, "127.0.0.1", () => {
    console.log(`[mcp] listening on http://127.0.0.1:${HTTP_PORT}/mcp`);
  });
}

function main(): void {
  const wsBridge = new WsBridge(WS_PORT);
  wsBridge.start();
  startHttpServer(wsBridge);

  const shutdown = (): void => {
    console.log("\n[server] shutting down");
    wsBridge.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main();
