import { WebSocketServer, WebSocket } from "ws";

const REQUEST_TIMEOUT_MS = 30_000;

type PendingRequest = {
  readonly resolve: (result: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timer: NodeJS.Timeout;
};

interface ExtensionResponse {
  readonly id: string;
  readonly ok: boolean;
  readonly result?: unknown;
  readonly error?: unknown;
}

interface ExtensionHello {
  readonly version: string;
  readonly userAgent: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseHello(raw: string): ExtensionHello | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      isRecord(parsed) &&
      parsed["v"] === 1 &&
      parsed["type"] === "hello" &&
      typeof parsed["version"] === "string" &&
      typeof parsed["userAgent"] === "string"
    ) {
      return { version: parsed["version"], userAgent: parsed["userAgent"] };
    }
  } catch {
    // fall through
  }
  return undefined;
}

function parseExtensionMessage(raw: string): ExtensionResponse | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || typeof parsed["id"] !== "string") return undefined;
    return {
      id: parsed["id"],
      ok: parsed["ok"] === true,
      result: parsed["result"],
      error: parsed["error"],
    };
  } catch {
    return undefined;
  }
}

export class WsBridge {
  private wss: WebSocketServer | null = null;
  private socket: WebSocket | null = null;
  private readonly pending = new Map<string, PendingRequest>();
  private nextId = 0;

  constructor(private readonly port: number) {}

  start(): void {
    this.wss = new WebSocketServer({ host: "127.0.0.1", port: this.port });
    this.wss.on("connection", (socket) => this.accept(socket));
    this.wss.on("error", (error) => {
      console.error(`[ws] server error: ${error.message}`);
    });
    console.log(`[ws] listening on ws://127.0.0.1:${this.port}`);
  }

  close(): void {
    this.socket?.close();
    this.socket = null;
    this.wss?.close();
    this.wss = null;
  }

  get isConnected(): boolean {
    return this.socket !== null && this.socket.readyState === WebSocket.OPEN;
  }

  sendToExtension(tool: string, params: unknown): Promise<unknown> {
    const socket = this.socket;
    if (!this.isConnected || socket === null) {
      return Promise.reject(
        new Error(
          "Chrome extension not connected (is it running and connected to ws://127.0.0.1:8765?)",
        ),
      );
    }
    return new Promise<unknown>((resolve, reject) => {
      const id = `srv-${++this.nextId}`;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Extension tool "${tool}" timed out after 30s`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ v: 1, id, tool, params }));
    });
  }

  private accept(socket: WebSocket): void {
    if (this.socket !== null && this.socket !== socket) {
      console.log("[ws] new extension connection, replacing the old one");
      this.socket.close();
    }
    this.socket = socket;
    console.log("[ws] extension connected");

    socket.on("message", (data) => this.onMessage(data.toString()));
    socket.on("close", () => {
      if (this.socket === socket) {
        this.socket = null;
        console.log("[ws] extension disconnected");
      }
    });
    socket.on("error", (error) => {
      console.error(`[ws] socket error: ${error.message}`);
    });
  }

  private onMessage(raw: string): void {
    const hello = parseHello(raw);
    if (hello !== undefined) {
      console.log(`[ws] extension hello: v${hello.version} (${hello.userAgent})`);
      return;
    }
    const message = parseExtensionMessage(raw);
    if (message === undefined) {
      console.warn("[ws] dropping malformed message from extension");
      return;
    }
    const pending = this.pending.get(message.id);
    if (pending === undefined) {
      console.warn(`[ws] no pending request for id ${message.id}`);
      return;
    }
    clearTimeout(pending.timer);
    this.pending.delete(message.id);
    if (message.ok) {
      pending.resolve(message.result);
    } else {
      pending.reject(
        new Error(
          typeof message.error === "string" && message.error.length > 0
            ? message.error
            : "Extension returned an unknown error",
        ),
      );
    }
  }
}
