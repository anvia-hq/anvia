import { ndJsonStream, type AnyMessage, type Stream } from "@agentclientprotocol/sdk";
import { ReadableStream, WritableStream } from "node:stream/web";
import type { AcpConnectionOptions } from "../types.js";
import { AcpError, errorCodes } from "../errors.js";
import { resolveLimits } from "../limits.js";

const errorMessages: Record<number, string> = {
  [-32700]: "Parse error",
  [-32600]: "Invalid request",
  [-32601]: "Method not found",
  [-32602]: "Invalid params",
  [-32603]: "Internal error",
};

export function createV1Stream(options: AcpConnectionOptions): Stream {
  const maximum = resolveLimits(options.limits).maxConcurrentRequests;
  const maxMessageBytes = options.maxMessageBytes ?? 10 * 1024 * 1024;
  if (!Number.isSafeInteger(maxMessageBytes) || maxMessageBytes <= 0)
    throw new TypeError("ACP maxMessageBytes must be a positive safe integer.");
  const pending = new Set<string | number>();
  let unidentified = 0;
  let incoming: ReadableStreamDefaultController<AnyMessage> | undefined;
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const output = new WritableStream<Uint8Array>({
    async write(chunk) {
      // SDK 1.9.0 emits one complete encoded frame per write, including framing errors.
      // Sanitize here because the SDK can attach the raw invalid envelope to error.data.
      const message = JSON.parse(decoder.decode(chunk)) as AnyMessage;
      // Parser replies bypass the admission reader. They must not free a slot
      // reserved by a null-ID request or malformed object awaiting its own reply.
      const framingError =
        "error" in message &&
        message.error &&
        (message.error.code === -32700 ||
          (message.error.code === -32600 &&
            (message.error.data === null || typeof message.error.data !== "object")));
      if ("method" in message && message.method === "$/cancel_request") {
        const params = message.params;
        const id =
          params && typeof params === "object" && "requestId" in params
            ? params.requestId
            : undefined;
        // SDK 1.9.0 only sends cancellation; it retains the pending response until
        // the peer replies. Settle locally too, so an unresponsive peer cannot leak
        // one SDK entry per cancelled permission/editor request. Late replies are
        // ignored by the SDK after it consumes this fixed local cancellation error.
        if (id === null || typeof id === "string" || typeof id === "number")
          incoming?.enqueue({
            jsonrpc: "2.0",
            id,
            error: { code: -32800, message: "Request cancelled" },
          });
      }
      if ("error" in message && message.error) {
        const { code, data } = message.error;
        const kind = data && typeof data === "object" && "kind" in data ? data.kind : undefined;
        message.error = {
          code,
          message: errorMessages[code] ?? "Request failed",
        };
        if (
          typeof kind === "string" &&
          Object.hasOwn(errorCodes, kind) &&
          errorCodes[kind as keyof typeof errorCodes] === code
        ) {
          message.error.data = { kind };
        }
        chunk = encoder.encode(JSON.stringify(message) + "\n");
      }
      const writer = options.output.getWriter();
      try {
        await writer.write(chunk);
        if (!("method" in message) && "id" in message) {
          if (message.id === null) {
            if (!framingError) unidentified = Math.max(0, unidentified - 1);
          } else pending.delete(message.id);
        }
      } finally {
        writer.releaseLock();
      }
    },
  });
  const stream = ndJsonStream(output, options.input, { maxMessageBytes });
  const reader = stream.readable.getReader();
  // Bound requests BEFORE the SDK allocates handlers/controllers or queues replies.
  // Responses and cancel notifications must still flow while prompt RPCs are pending.
  const readable = new ReadableStream<AnyMessage>({
    start(controller) {
      incoming = controller;
    },
    async pull(controller) {
      try {
        const { value, done } = await reader.read();
        if (done) {
          pending.clear();
          unidentified = 0;
          incoming = undefined;
          reader.releaseLock();
          controller.close();
          return;
        }
        const call =
          "jsonrpc" in value &&
          value.jsonrpc === "2.0" &&
          "method" in value &&
          typeof value.method === "string";
        const notification = call && !("id" in value);
        // Match the SDK's response-shaped routing, including malformed replies:
        // they settle/ignore an outbound request and never queue an error response.
        const reply =
          !("method" in value) && ("id" in value || "result" in value || "error" in value);
        if (!notification && !reply) {
          const id =
            call &&
            "id" in value &&
            (typeof value.id === "string" ||
              (typeof value.id === "number" && Number.isFinite(value.id)))
              ? value.id
              : null;
          if (pending.size + unidentified >= maximum || (id !== null && pending.has(id)))
            throw new AcpError("resource_limit");
          if (id === null) unidentified++;
          else pending.add(id);
        }
        controller.enqueue(value);
      } catch (error) {
        pending.clear();
        unidentified = 0;
        incoming = undefined;
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
        controller.error(error);
      }
    },
    async cancel() {
      pending.clear();
      unidentified = 0;
      incoming = undefined;
      try {
        await reader.cancel();
      } finally {
        reader.releaseLock();
      }
    },
  });
  return { readable, writable: stream.writable };
}
