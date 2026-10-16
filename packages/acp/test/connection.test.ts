import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AcpConnection, AcpOptions } from "../src/index.js";
import { serveStdio } from "../src/stdio.js";

const connections: AcpConnection[] = [];
afterEach(async () => {
  await Promise.all(connections.splice(0).map((connection) => connection.close()));
});

function fixture(options: Partial<AcpOptions> = {}) {
  const input = new PassThrough();
  const output = new PassThrough();
  const responses: Array<{
    jsonrpc: string;
    id: number | string | null;
    result?: unknown;
    error?: { code: number; data?: unknown };
  }> = [];
  let buffer = "";
  output.setEncoding("utf8").on("data", (chunk: string) => {
    buffer += chunk;
    let newline: number;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      responses.push(JSON.parse(buffer.slice(0, newline)));
      buffer = buffer.slice(newline + 1);
    }
  });
  const sessionFactory = vi.fn(() => {
    throw new Error("Session creation is not implemented in ACP 02.");
  });
  const connection = serveStdio({ input, output, sessionFactory, ...options });
  connections.push(connection);
  let nextId = 0;
  return {
    input,
    output,
    responses,
    connection,
    sessionFactory,
    async request(method: string, params?: unknown) {
      const id = ++nextId;
      input.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
      await vi.waitFor(() => expect(responses.some((response) => response.id === id)).toBe(true));
      return responses.find((response) => response.id === id)!;
    },
  };
}

describe("ACP v1 transport", () => {
  it.each([1, 2, 999])(
    "negotiates v1 from version %s with only implemented capabilities",
    async (version) => {
      const peer = fixture();
      const response = await peer.request("initialize", {
        protocolVersion: version,
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true },
      });
      expect(response).toEqual({
        jsonrpc: "2.0",
        id: 1,
        result: {
          protocolVersion: 1,
          agentInfo: { name: "anvia", version: expect.any(String) },
          authMethods: [],
          agentCapabilities: {
            loadSession: false,
            promptCapabilities: { image: false, audio: false, embeddedContext: false },
            mcpCapabilities: { http: false, sse: false },
            sessionCapabilities: {},
          },
        },
      });
      expect(peer.sessionFactory).not.toHaveBeenCalled();
    },
  );

  it("requires initialization and rejects duplicate initialization per connection", async () => {
    const peer = fixture();
    expect((await peer.request("authenticate", { methodId: "unused" })).error).toMatchObject({
      code: -32600,
      data: { kind: "not_initialized" },
    });
    await peer.request("initialize", { protocolVersion: 1 });
    expect((await peer.request("initialize", { protocolVersion: 1 })).error).toMatchObject({
      code: -32600,
      data: { kind: "already_initialized" },
    });
    expect((await fixture().request("initialize", { protocolVersion: 1 })).error).toBeUndefined();
  });

  it("authenticates idempotently without advertising an auth method", async () => {
    const peer = fixture({ agentInfo: { name: "custom", version: "2" } });
    expect((await peer.request("initialize", { protocolVersion: 1 })).result).toMatchObject({
      agentInfo: { name: "custom", version: "2" },
    });
    for (let attempt = 0; attempt < 2; attempt++) {
      expect((await peer.request("authenticate", { methodId: "anything" })).result).toEqual({});
    }
  });

  it.each(["unknown", "session/load", "session/set_mode"])(
    "returns method-not-found for %s",
    async (method) => {
      expect((await fixture().request(method, {})).error?.code).toBe(-32601);
    },
  );

  it.each([
    ["initialize", {}],
    ["initialize", { protocolVersion: "1" }],
    ["initialize", { protocolVersion: -1 }],
    ["authenticate", {}],
    ["authenticate", { methodId: 1 }],
  ])("validates %s params before dispatch", async (method, params) => {
    const peer = fixture();
    expect((await peer.request(method as string, params)).error?.code).toBe(-32602);
    expect((await peer.request("initialize", { protocolVersion: 1 })).error).toBeUndefined();
  });

  it("uses the SDK's conservative fallback for malformed optional capabilities", async () => {
    const peer = fixture();
    expect(
      (
        await peer.request("initialize", {
          protocolVersion: 1,
          clientCapabilities: { terminal: "yes" },
        })
      ).result,
    ).toMatchObject({ protocolVersion: 1 });
    expect(peer.sessionFactory).not.toHaveBeenCalled();
  });

  it("handles malformed JSON and invalid envelopes, then continues reading", async () => {
    const peer = fixture();
    peer.input.write('{broken\n{"foo":"bar"}\n42\n');
    await vi.waitFor(() => expect(peer.responses).toHaveLength(3));
    expect(peer.responses.map((response) => response.error?.code)).toEqual([
      -32700, -32600, -32600,
    ]);
    expect(peer.responses.every((response) => response.id === null)).toBe(true);
    expect((await peer.request("initialize", { protocolVersion: 1 })).error).toBeUndefined();
  });

  it("reads split UTF-8 frames and never responds to notifications", async () => {
    const peer = fixture();
    const frame = Buffer.from(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "café",
        method: "initialize",
        params: { protocolVersion: 1 },
      }) + "\r\n",
    );
    for (const byte of frame) peer.input.write(Buffer.from([byte]));
    await vi.waitFor(() => expect(peer.responses).toHaveLength(1));
    expect(peer.responses[0]?.id).toBe("café");
    peer.input.write('{"jsonrpc":"2.0","method":"unknown","params":{}}\n');
    await peer.request("authenticate", { methodId: "unused" });
    expect(peer.responses).toHaveLength(2);
  });

  it("omits raw request data and method names from SDK error responses", async () => {
    const peer = fixture();
    peer.input.write('{"private-prompt":"secret-input"}\n"secret-input"\n');
    await vi.waitFor(() => expect(peer.responses).toHaveLength(2));
    await peer.request("secret-input", {});
    await peer.request("initialize", { protocolVersion: "secret-input" });
    expect(peer.responses.every((response) => response.error)).toBe(true);
    expect(JSON.stringify(peer.responses)).not.toContain("secret-input");
  });

  it("closes on EOF and allows repeated close without ending caller-owned output", async () => {
    const peer = fixture();
    await peer.request("initialize", { protocolVersion: 1 });
    peer.input.end();
    await peer.connection.closed;
    await peer.connection.close();
    await peer.connection.close();
    expect(peer.output.writableEnded).toBe(false);
  });

  it("closes when an incoming message exceeds the configured limit", async () => {
    const peer = fixture({ maxMessageBytes: 32 });
    peer.input.write("x".repeat(33));
    await peer.connection.closed;
  });

  it("closes on output failure", async () => {
    const peer = fixture();
    peer.output.destroy(new Error("Broken pipe"));
    peer.input.write(
      '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1}}\n',
    );
    await peer.connection.closed;
  });
});
