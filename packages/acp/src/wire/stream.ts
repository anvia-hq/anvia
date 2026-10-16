import { ndJsonStream, type AnyMessage, type Stream } from "@agentclientprotocol/sdk";
import { WritableStream } from "node:stream/web";
import type { AcpConnectionOptions } from "../types.js";

const errorMessages: Record<number, string> = {
  [-32700]: "Parse error",
  [-32600]: "Invalid request",
  [-32601]: "Method not found",
  [-32602]: "Invalid params",
  [-32603]: "Internal error",
};

export function createV1Stream(options: AcpConnectionOptions): Stream {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const output = new WritableStream<Uint8Array>({
    async write(chunk) {
      // SDK 1.9.0 emits one complete encoded frame per write, including framing errors.
      // Sanitize here because the SDK can attach the raw invalid envelope to error.data.
      const message = JSON.parse(decoder.decode(chunk)) as AnyMessage;
      if ("error" in message && message.error) {
        const { code, data } = message.error;
        const kind = data && typeof data === "object" && "kind" in data ? data.kind : undefined;
        message.error = {
          code,
          message: errorMessages[code] ?? "Request failed",
        };
        if (code === -32600 && (kind === "already_initialized" || kind === "not_initialized")) {
          message.error.data = { kind };
        }
        chunk = encoder.encode(JSON.stringify(message) + "\n");
      }
      const writer = options.output.getWriter();
      try {
        await writer.write(chunk);
      } finally {
        writer.releaseLock();
      }
    },
  });
  return ndJsonStream(output, options.input, {
    maxMessageBytes: options.maxMessageBytes ?? 10 * 1024 * 1024,
  });
}
