import { createTool, createToolkit, normalizeToolResultOutput, ToolOutput } from "@anvia/core/tool";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { withToolCache } from "../src/tools/cache";
import { httpClient } from "../src/tools/http";
import { InMemoryTodoStore, todo } from "../src/tools/todo";

const publicResolver = async () => [{ address: "93.184.216.34", family: 4 }];

describe("httpClient toolkit", () => {
  it("fails closed when neither baseUrl nor allowedHosts is provided or allowedHosts is empty", () => {
    expect(() => httpClient({})).toThrow(/requires either baseUrl or at least one allowedHosts/);
    expect(() => httpClient({ baseUrl: "https://api.example.com", allowedHosts: [] })).toThrow(
      /allowedHosts must not be empty/,
    );
  });

  it("resolves baseUrl, protects config headers, enforces origin/port/scheme, and checks redirect methods", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (url, init) => {
      if (String(url) === "https://api.example.com:8443/v1/redirect-post") {
        return new Response(null, {
          status: 303,
          headers: { location: "https://api.example.com:8443/v1/items" },
        });
      }

      expect(String(url)).toBe("https://api.example.com:8443/v1/items?limit=10");
      const headers = init?.headers as Record<string, string>;
      expect(headers.authorization).toBe("Bearer real-secret");
      expect(headers["x-trace"]).toBe("abc");
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    const kit = httpClient({
      baseUrl: "https://api.example.com:8443",
      allowedMethods: ["GET", "POST"],
      headers: { Authorization: "Bearer real-secret" },
      resolveAddress: publicResolver,
      fetch: fetchMock,
    });

    const res = (await kit.tools[0]!.call({
      method: "GET",
      url: "/v1/items",
      query: { limit: "10" },
      headers: { Authorization: "Bearer attacker", "X-Trace": "abc" },
    })) as { status: number; body: string };

    expect(res.status).toBe(200);
    expect(res.body).toBe('{"ok":true}');

    await expect(
      kit.tools[0]!.call({ method: "GET", url: "http://api.example.com:8443/v1/items" }),
    ).rejects.toThrow(/allowedOrigins/);

    await expect(
      kit.tools[0]!.call({ method: "GET", url: "https://api.example.com:9090/v1/items" }),
    ).rejects.toThrow(/allowedOrigins/);

    await expect(kit.tools[0]!.call({ method: "DELETE", url: "/v1/items/1" })).rejects.toThrow(
      /not allowed/,
    );

    const postOnlyKit = httpClient({
      baseUrl: "https://api.example.com:8443",
      allowedMethods: ["POST"],
      resolveAddress: publicResolver,
      fetch: fetchMock,
    });
    await expect(
      postOnlyKit.tools[0]!.call({ method: "POST", url: "/v1/redirect-post", body: "{}" }),
    ).rejects.toThrow(/HTTP method "GET" is not allowed/);
  });
});

describe("todo toolkit", () => {
  it("reads and writes ordered todo items and rejects duplicate IDs", async () => {
    const store = new InMemoryTodoStore();
    const kit = todo({ store });
    const byName = new Map(kit.tools.map((t) => [t.name, t]));

    expect(await byName.get("todo_read")!.call({})).toEqual({ count: 0, items: [] });

    await byName.get("todo_write")!.call({
      items: [
        { id: "1", content: "Write plan", status: "completed" },
        { id: "2", content: "Ship tests", status: "in_progress" },
      ],
    });

    expect(await byName.get("todo_read")!.call({})).toEqual({
      count: 2,
      items: [
        { id: "1", content: "Write plan", status: "completed" },
        { id: "2", content: "Ship tests", status: "in_progress" },
      ],
    });

    await expect(
      byName.get("todo_write")!.call({
        items: [
          { id: "dup", content: "A", status: "pending" },
          { id: "dup", content: "B", status: "pending" },
        ],
      }),
    ).rejects.toThrow(/Duplicate todo item id/);
  });
});

describe("withToolCache", () => {
  it("caches results by canonical args with TTL, true LRU eviction, RichToolOutput preservation, and Toolkit filtering", async () => {
    let clock = 1_000;
    const handler = vi.fn(({ a, b }: { a: number; b: number }) => ({ sum: a + b }));
    const calc = createTool({
      name: "calc",
      description: "Add numbers",
      inputSchema: z.object({ a: z.number(), b: z.number() }),
      handler,
    });

    const cached = withToolCache(calc, { ttlMs: 1_000, maxEntries: 2, now: () => clock });

    expect(await cached.call({ a: 1, b: 2 })).toEqual({ sum: 3 });
    expect(await cached.call({ b: 2, a: 1 })).toEqual({ sum: 3 });
    expect(handler).toHaveBeenCalledTimes(1);

    await cached.call({ a: 2, b: 3 });
    await cached.call({ a: 1, b: 2 });
    await cached.call({ a: 3, b: 4 });
    expect(handler).toHaveBeenCalledTimes(3);

    await cached.call({ a: 1, b: 2 });
    expect(handler).toHaveBeenCalledTimes(3);

    await cached.call({ a: 2, b: 3 });
    expect(handler).toHaveBeenCalledTimes(4);

    clock += 1_500;
    expect(await cached.call({ a: 1, b: 2 })).toEqual({ sum: 3 });
    expect(handler).toHaveBeenCalledTimes(5);

    const richHandler = vi.fn(() => ToolOutput.content([{ type: "text", text: "rich-body" }]));
    const richTool = createTool({
      name: "rich",
      description: "Rich tool",
      inputSchema: z.object({}),
      handler: richHandler,
    });
    const otherHandler = vi.fn(() => "uncached");
    const otherTool = createTool({
      name: "other",
      description: "Other tool",
      inputSchema: z.object({}),
      handler: otherHandler,
    });

    const kit = createToolkit({ name: "mixed", tools: [richTool, otherTool] });
    const cachedKit = withToolCache(kit, { ttlMs: 5_000, tools: ["rich"] });

    const first = await cachedKit.tools[0]!.call({});
    const second = await cachedKit.tools[0]!.call({});
    expect(richHandler).toHaveBeenCalledTimes(1);
    expect(normalizeToolResultOutput(first)).toEqual({
      type: "content",
      value: [{ type: "text", text: "rich-body" }],
    });
    expect(normalizeToolResultOutput(second)).toEqual({
      type: "content",
      value: [{ type: "text", text: "rich-body" }],
    });

    await cachedKit.tools[1]!.call({});
    await cachedKit.tools[1]!.call({});
    expect(otherHandler).toHaveBeenCalledTimes(2);

    expect(() => withToolCache(kit, { ttlMs: 5_000, tools: ["unknown"] })).toThrow(
      /Unknown tool "unknown"/,
    );
  });
});
