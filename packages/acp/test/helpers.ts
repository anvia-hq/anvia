import type { SessionNotification } from "@agentclientprotocol/sdk";
import { Agent } from "@anvia/core/agent";
import { Usage, type CompletionModel, type CompletionRequest } from "@anvia/core/completion";
import { PassThrough } from "node:stream";
import { expect, vi } from "vitest";
import type { AcpOptions } from "../src/types.js";
import { serveStdio } from "../src/stdio.js";

export function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

export function makeAgent(before?: (request: CompletionRequest) => Promise<void>) {
  const requests: CompletionRequest[] = [];
  const model: CompletionModel = {
    provider: "fixture",
    modelId: "offline",
    capabilities: {
      streaming: false,
      tools: true,
      toolChoice: true,
      imageInput: true,
      documentInput: false,
      outputSchema: false,
      reasoning: false,
    },
    async completion(request) {
      requests.push(structuredClone(request));
      await before?.(request);
      return {
        choice: [{ type: "text", text: "reply" }],
        usage: Usage.empty(),
        rawResponse: {},
      };
    },
  };
  return { agent: new Agent({ id: "fixture", model, retries: false }), requests, model };
}

type Response = {
  id?: number;
  method?: string;
  params?: SessionNotification;
  result?: { sessionId?: string; stopReason?: string; agentCapabilities?: unknown };
  error?: { code: number; data?: { kind: string } };
};

export function wireFixture(options: AcpOptions) {
  const input = new PassThrough();
  const output = new PassThrough();
  const responses: Response[] = [];
  let buffer = "";
  output.setEncoding("utf8").on("data", (chunk: string) => {
    buffer += chunk;
    let newline: number;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      responses.push(JSON.parse(buffer.slice(0, newline)));
      buffer = buffer.slice(newline + 1);
    }
  });
  const connection = serveStdio({ ...options, input, output });
  let nextId = 0;
  return {
    connection,
    input,
    responses,
    async request(method: string, params: unknown): Promise<Response> {
      const id = ++nextId;
      input.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
      await vi.waitFor(() => expect(responses.some((response) => response.id === id)).toBe(true), {
        timeout: 10_000,
      });
      return responses.find((response) => response.id === id)!;
    },
  };
}
