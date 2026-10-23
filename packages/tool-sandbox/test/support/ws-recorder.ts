import WebSocket, { WebSocketServer } from "ws";

/** One WebSocket message that crossed the link. `type` is the JSON frame's, for text messages. */
export interface RecordedMessage {
  from: "daemon" | "hub";
  binary: boolean;
  size: number;
  type?: string;
}

/**
 * A WebSocket proxy between a daemon and a hub that passes every message through unchanged, binary
 * or text, and writes down what each one was. It is how a test sees what actually went over the
 * wire, which no assertion about the data arriving could show.
 */
export class WsRecorder {
  readonly messages: RecordedMessage[] = [];
  private readonly server = new WebSocketServer({ port: 0, host: "127.0.0.1" });

  constructor(hubPort: number) {
    this.server.on("connection", (client, request) => {
      const headers: Record<string, string> = {};
      if (request.headers.authorization !== undefined) {
        headers.authorization = request.headers.authorization;
      }
      const upstream = new WebSocket(`ws://127.0.0.1:${hubPort}`, { headers });
      const waiting: Array<[WebSocket.RawData, boolean]> = [];
      const forward =
        (from: "daemon" | "hub", to: WebSocket) => (data: WebSocket.RawData, binary: boolean) => {
          this.messages.push(describe(from, data, binary));
          to.send(data, { binary });
        };
      client.on("message", (data, binary) => {
        if (upstream.readyState === WebSocket.OPEN) forward("daemon", upstream)(data, binary);
        else waiting.push([data, binary]);
      });
      upstream.on("open", () => {
        for (const [data, binary] of waiting.splice(0)) forward("daemon", upstream)(data, binary);
      });
      upstream.on("message", forward("hub", client));
      client.on("close", (code) => upstream.close(usable(code)));
      upstream.on("close", (code) => client.close(usable(code)));
      client.on("error", () => upstream.terminate());
      upstream.on("error", () => client.terminate());
    });
  }

  async listen(): Promise<number> {
    if (!this.server.address())
      await new Promise((resolve) => this.server.once("listening", resolve));
    return (this.server.address() as { port: number }).port;
  }

  close(): void {
    for (const client of this.server.clients) client.terminate();
    this.server.close();
  }

  /** Binary messages that went `from`, and the payload bytes in them. */
  binary(from: "daemon" | "hub"): { count: number; bytes: number } {
    const sent = this.messages.filter((message) => message.from === from && message.binary);
    return { count: sent.length, bytes: sent.reduce((total, message) => total + message.size, 0) };
  }

  /** Text messages of a JSON frame type that went `from`. */
  text(from: "daemon" | "hub", type: string): number {
    return this.messages.filter(
      (message) => message.from === from && !message.binary && message.type === type,
    ).length;
  }
}

function describe(
  from: "daemon" | "hub",
  data: WebSocket.RawData,
  binary: boolean,
): RecordedMessage {
  const size = Array.isArray(data)
    ? data.reduce((total, part) => total + part.byteLength, 0)
    : data.byteLength;
  if (binary) return { from, binary, size };
  try {
    const buffer = Array.isArray(data)
      ? Buffer.concat(data)
      : Buffer.isBuffer(data)
        ? data
        : Buffer.from(data);
    const text = buffer.toString();
    const parsed: unknown = JSON.parse(text);
    const type = (parsed as { type?: unknown }).type;
    return typeof type === "string" ? { from, binary, size, type } : { from, binary, size };
  } catch {
    return { from, binary, size };
  }
}

/** Close codes 1005 and 1006 are not allowed on the wire. */
function usable(code: number): number {
  return code === 1005 || code === 1006 || code === 1015 ? 1000 : code;
}
