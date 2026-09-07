import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LensClient,
  LensPromptCompilationError,
  type LensChatPrompt,
  type LensTextPrompt,
} from "../src/index";

let lens: LensClient | undefined;

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  await lens?.close();
  lens = undefined;
});

describe("Lens prompt client", () => {
  it("fetches a text prompt with the default production label", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      response({
        name: "support/greeting",
        version: 3,
        type: "text",
        template: "Hello {{ name }}, {{count}} uses \\{{literal}}!",
        messages: null,
        config: { count: 3, nested: { deep: true } },
        labels: ["production", "beta"],
        selector: { label: "production" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    lens = createClient();
    const prompt = (await lens
      .promptClient()
      .getPrompt({ name: "support/greeting" })) as LensTextPrompt;

    expect(prompt.type).toBe("text");
    expect(prompt.name).toBe("support/greeting");
    expect(prompt.version).toBe(3);
    expect(prompt.ref).toEqual({ name: "support/greeting", version: 3 });
    expect(prompt.config).toEqual({ count: 3, nested: { deep: true } });
    expect(prompt.labels).toEqual(["production", "beta"]);
    expect(prompt.selector).toEqual({ label: "production" });
    expect(prompt.variables).toEqual(["name", "count"]);
    expect(prompt.template).toBe("Hello {{ name }}, {{count}} uses \\{{literal}}!");
    expect(prompt.messages).toBeNull();
    // Config values are not variables: compilation requires them to be passed explicitly.
    expect(() => prompt.compile({ name: "Ada" })).toThrow(LensPromptCompilationError);
    expect(prompt.compile({ name: "Ada", count: "3", extra: "ignored" })).toBe(
      "Hello Ada, 3 uses {{literal}}!",
    );
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe(
      "https://lens.example/api/public/prompts/support%2Fgreeting?label=production",
    );
    expect(init.headers).toEqual(
      expect.objectContaining({
        Authorization: `Basic ${Buffer.from("pk:sk").toString("base64")}`,
      }),
    );
  });

  it("requests an explicit label and version with the contracted route", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response(textPrompt({ name: "p", labels: ["beta"], selector: { label: "beta" } })),
      )
      .mockResolvedValueOnce(
        response(textPrompt({ name: "p", version: 2, selector: { version: 2 } })),
      );
    vi.stubGlobal("fetch", fetchMock);
    lens = createClient();
    const client = lens.promptClient();

    await client.getPrompt({ name: "p", label: " beta " });
    await client.getPrompt({ name: "p", version: 2 });
    expect((fetchMock.mock.calls[0] as [URL])[0].search).toBe("?label=beta");
    expect((fetchMock.mock.calls[1] as [URL])[0].search).toBe("?version=2");
  });

  it("compiles chat prompts into fresh messages preserving names and roles", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        response({
          name: "chat/assistant",
          version: 7,
          type: "chat",
          template: null,
          messages: [
            { role: "system", content: "Be {{tone}}.", name: "policy" },
            { role: "user", content: "Hi {{name}}" },
          ],
          config: { tone: "kind" },
          labels: ["production"],
          selector: { label: "production" },
        }),
      ),
    );
    lens = createClient();
    const prompt = (await lens
      .promptClient()
      .getPrompt({ name: "chat/assistant" })) as LensChatPrompt;

    expect(prompt.type).toBe("chat");
    expect(prompt.template).toBeNull();
    expect(prompt.messages).toEqual([
      { role: "system", content: "Be {{tone}}.", name: "policy" },
      { role: "user", content: "Hi {{name}}" },
    ]);
    expect(prompt.variables).toEqual(["tone", "name"]);
    const first = prompt.compile({ tone: "kind", name: "Ada" });
    const second = prompt.compile({ tone: "kind", name: "Ada" });
    expect(first).toEqual([
      { role: "system", content: "Be kind.", name: "policy" },
      { role: "user", content: "Hi Ada" },
    ]);
    expect(first).not.toBe(second);
    expect(first[0]).not.toBe(prompt.messages[0]);
    first.push({ role: "assistant", content: "mutated" });
    expect(prompt.messages).toHaveLength(2);
  });

  it("freezes snapshots deeply for cache safety", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response(textPrompt({ name: "frozen" }))));
    lens = createClient();
    const prompt = await lens.promptClient().getPrompt({ name: "frozen" });

    expect(Object.isFrozen(prompt)).toBe(true);
    expect(Object.isFrozen(prompt.ref)).toBe(true);
    expect(Object.isFrozen(prompt.config)).toBe(true);
    expect(Object.isFrozen((prompt.config as { nested: object }).nested)).toBe(true);
    expect(Object.isFrozen(prompt.labels)).toBe(true);
    expect(Object.isFrozen(prompt.selector)).toBe(true);
  });

  it("compiles strictly: missing variables typed, non-strings rejected, config not interpolated", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        response(
          textPrompt({
            name: "strict",
            template: "{{a}} {{b}} {{recursive}}",
            config: { recursive: "{{a}}" },
          }),
        ),
      ),
    );
    lens = createClient();
    const prompt = (await lens.promptClient().getPrompt({ name: "strict" })) as LensTextPrompt;

    expect(() => prompt.compile()).toThrow(LensPromptCompilationError);
    expect(() => prompt.compile()).toThrow("missing variables: a, b, recursive");
    let failure: LensPromptCompilationError | undefined;
    try {
      prompt.compile({ a: "1", b: "2" });
    } catch (error) {
      failure = error as LensPromptCompilationError;
    }
    expect(failure?.code).toBe("missing_variable");
    expect(() => prompt.compile({ a: "1", b: "2", recursive: 42 as never })).toThrow(
      'variable "recursive" must be a string',
    );
    expect(prompt.compile({ a: "1", b: "2", recursive: "{{a}}" })).toBe("1 2 {{a}}");
  });

  it("renders escaped placeholders literally without registering variables", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          response(textPrompt({ name: "escaped", template: "\\{{name}} {{ name }}" })),
        ),
    );
    lens = createClient();
    const prompt = (await lens.promptClient().getPrompt({ name: "escaped" })) as LensTextPrompt;

    expect(prompt.variables).toEqual(["name"]);
    expect(prompt.compile({ name: "Ada" })).toBe("{{name}} Ada");
    expect(prompt.compile({ name: "Ada" })).toBe("{{name}} Ada");
  });

  it("validates selector and option inputs", async () => {
    vi.stubGlobal("fetch", vi.fn());
    lens = createClient();
    const client = lens.promptClient();

    await expect(client.getPrompt({ name: "  " })).rejects.toThrow("name is required");
    await expect(client.getPrompt({ name: "p", label: "a", version: 1 } as never)).rejects.toThrow(
      "exactly one of label or version",
    );
    await expect(client.getPrompt({ name: "p", version: 0 })).rejects.toThrow(
      "positive safe integer",
    );
    await expect(client.getPrompt({ name: "p", version: 1.5 })).rejects.toThrow(
      "positive safe integer",
    );
    await expect(client.getPrompt({ name: "p", label: "" })).rejects.toThrow("label is required");
    await expect(client.getPrompt({ name: "p", cache: "forever" as never })).rejects.toThrow(
      "cache mode is invalid",
    );
    expect(() => lens?.promptClient({ timeoutMs: 0 })).toThrow("timeoutMs");
    expect(() => lens?.promptClient({ timeoutMs: 1.5 })).toThrow("timeoutMs");
    expect(() => lens?.promptClient({ cacheTtlMs: -1 })).toThrow("cacheTtlMs");
  });

  it("serves cache hits within the TTL and refetches after expiry", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(textPrompt({ name: "cached", version: 1 })))
      .mockResolvedValueOnce(response(textPrompt({ name: "cached", version: 2 })));
    vi.stubGlobal("fetch", fetchMock);
    lens = createClient();
    const client = lens.promptClient({ cacheTtlMs: 60_000 });

    const first = await client.getPrompt({ name: "cached" });
    expect(await client.getPrompt({ name: "cached" })).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_001);
    const second = await client.getPrompt({ name: "cached" });
    expect(second.version).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("never falls back to expired entries when a refresh fails", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(textPrompt({ name: "stale" })))
      .mockResolvedValueOnce(response({ error: { code: "boom", message: "down" } }, 500))
      .mockResolvedValueOnce(response(textPrompt({ name: "stale", version: 9 })));
    vi.stubGlobal("fetch", fetchMock);
    lens = createClient();
    const client = lens.promptClient({ cacheTtlMs: 1000 });

    await client.getPrompt({ name: "stale" });
    vi.advanceTimersByTime(1001);
    await expect(client.getPrompt({ name: "stale" })).rejects.toMatchObject({ code: "boom" });
    expect((await client.getPrompt({ name: "stale" })).version).toBe(9);
  });

  it("reload refreshes and no-store bypasses reads and writes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(textPrompt({ name: "modes", version: 1 })))
      .mockResolvedValueOnce(response(textPrompt({ name: "modes", version: 2 })))
      .mockResolvedValueOnce(response(textPrompt({ name: "modes", version: 3 })));
    vi.stubGlobal("fetch", fetchMock);
    lens = createClient();
    const client = lens.promptClient();

    expect((await client.getPrompt({ name: "modes" })).version).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await client.getPrompt({ name: "modes", cache: "reload" })).version).toBe(2);
    expect((await client.getPrompt({ name: "modes" })).version).toBe(2);
    expect((await client.getPrompt({ name: "modes", cache: "no-store" })).version).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // no-store wrote nothing: the reloaded value is still served from cache.
    expect((await client.getPrompt({ name: "modes" })).version).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("clearCache forces a refetch and discards in-flight results", async () => {
    let release: (value: Response) => void = () => {};
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            release = resolve;
          }),
      )
      .mockResolvedValueOnce(response(textPrompt({ name: "reset", version: 5 })));
    vi.stubGlobal("fetch", fetchMock);
    lens = createClient();
    const client = lens.promptClient();

    const inFlight = client.getPrompt({ name: "reset" });
    client.clearCache();
    release(response(textPrompt({ name: "reset", version: 2 })));
    expect((await inFlight).version).toBe(2);
    expect((await client.getPrompt({ name: "reset" })).version).toBe(5);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("deduplicates concurrent identical requests", async () => {
    let release: (value: Response) => void = () => {};
    const fetchMock = vi.fn().mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    lens = createClient();
    const client = lens.promptClient();

    const first = client.getPrompt({ name: "shared" });
    const second = client.getPrompt({ name: "shared" });
    release(response(textPrompt({ name: "shared" })));
    expect(await first).toBe(await second);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps deduplicated requests alive when only one caller aborts", async () => {
    let release: (value: Response) => void = () => {};
    const fetchMock = vi.fn().mockImplementation(
      (_url: URL, init: RequestInit) =>
        new Promise<Response>((resolve) => {
          init.signal?.addEventListener("abort", () =>
            resolve(response(textPrompt({ name: "racers" }))),
          );
          release = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    lens = createClient();
    const client = lens.promptClient();
    const controller = new AbortController();

    const aborting = client.getPrompt({ name: "racers", signal: controller.signal });
    const staying = client.getPrompt({ name: "racers" });
    controller.abort();
    await expect(aborting).rejects.toMatchObject({ code: "aborted" });
    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(init.signal?.aborted).toBe(false);
    release(response(textPrompt({ name: "racers" })));
    expect(await staying).toBeTruthy();
  });

  it("aborts the underlying request when the sole caller aborts and caches nothing", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        (_url: URL, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => reject(new Error("Aborted")));
          }),
      )
      .mockResolvedValueOnce(response(textPrompt({ name: "solo" })));
    vi.stubGlobal("fetch", fetchMock);
    lens = createClient();
    const client = lens.promptClient();
    const controller = new AbortController();

    const request = client.getPrompt({ name: "solo", signal: controller.signal });
    controller.abort();
    await expect(request).rejects.toMatchObject({ code: "aborted" });
    expect((fetchMock.mock.calls[0] as [URL, RequestInit])[1].signal?.aborted).toBe(true);
    await client.getPrompt({ name: "solo" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("distinguishes server, network, timeout, and invalid-response failures", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response({ error: { code: "not_found", message: "internal pk-secret detail" } }, 404),
      )
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockImplementationOnce(
        (_url: URL, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => reject(new Error("Aborted")));
          }),
      )
      .mockResolvedValueOnce(new Response("not json", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    lens = createClient();
    const client = lens.promptClient({ timeoutMs: 5 });

    const cases: Array<[string, Record<string, unknown>]> = [
      ["not_found", { status: 404, message: "Lens prompt request failed (404)" }],
      ["network_error", {}],
      ["timeout", {}],
      ["invalid_response", {}],
    ];
    const messages: string[] = [];
    for (const [code, extra] of cases) {
      const error: unknown = await client.getPrompt({ name: "x" }).catch((cause: unknown) => cause);
      expect(error).toMatchObject({ name: "LensPromptError", code, ...extra });
      messages.push((error as Error).message);
    }
    expect(messages.every((message) => !message.includes("pk-secret"))).toBe(true);
  });

  it("rejects responses whose identity or shape does not match the request", async () => {
    const cases = [
      textPrompt({ name: "other" }),
      textPrompt({ name: "p", version: 1.5 }),
      textPrompt({ name: "p", selector: { label: "beta" } }),
      textPrompt({ name: "p", labels: ["beta"], selector: { label: "production" } }),
      textPrompt({ name: "p", version: 2, selector: { version: 3 } }),
      { ...textPrompt({ name: "p" }), selector: { label: "production", version: 1 } },
      { ...textPrompt({ name: "p" }), config: "nope" },
      { ...textPrompt({ name: "p" }), labels: "production" },
      { ...textPrompt({ name: "p" }), messages: [] },
      { ...textPrompt({ name: "p" }), type: "weird" },
      { ...textPrompt({ name: "p" }), template: null },
      { ...chatPrompt({ name: "p" }), messages: [{ role: "bot", content: "hi" }] },
      { ...chatPrompt({ name: "p" }), messages: [{ role: "user", content: 5 }] },
      { ...chatPrompt({ name: "p" }), messages: [] },
      { ...chatPrompt({ name: "p" }), template: "text" },
    ];
    for (const value of cases) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response(value)));
      lens ??= createClient();
      await expect(lens.promptClient().getPrompt({ name: "p" })).rejects.toMatchObject({
        code: "invalid_response",
      });
      vi.unstubAllGlobals();
    }
  });

  it("evicts the oldest entry when the cache exceeds its bound", async () => {
    const fetchMock = vi.fn((url: URL) =>
      Promise.resolve(
        response(textPrompt({ name: decodeURIComponent(url.pathname.split("/").pop() ?? "") })),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    lens = createClient();
    const client = lens.promptClient();

    for (let index = 0; index < 101; index += 1) {
      await client.getPrompt({ name: `p${index}` });
    }
    await client.getPrompt({ name: "p0" });
    expect(fetchMock).toHaveBeenCalledTimes(102);
    await client.getPrompt({ name: "p100" });
    expect(fetchMock).toHaveBeenCalledTimes(102);
  });

  it("enforces client lifecycle and disabled semantics", async () => {
    vi.stubEnv("ANVIA_LENS_BASE_URL", "");
    vi.stubEnv("ANVIA_LENS_PUBLIC_KEY", "");
    vi.stubEnv("ANVIA_LENS_SECRET_KEY", "");
    const disabled = new LensClient({ optional: true });
    expect(() => disabled.promptClient()).toThrow("disabled");

    vi.stubGlobal("fetch", vi.fn());
    lens = createClient();
    const client = lens.promptClient();
    expect(typeof client.getPrompt).toBe("function");
    expect(typeof client.clearCache).toBe("function");
    await lens.close();
    lens = undefined;
    expect(() => client.clearCache()).toThrow("LensClient is closed.");
    await expect(client.getPrompt({ name: "p" })).rejects.toThrow("LensClient is closed.");

    const closed = createClient();
    await closed.close();
    expect(() => closed.promptClient()).toThrow("LensClient is closed.");
  });
});

function createClient(options: { timeoutMs?: number } = {}): LensClient {
  return new LensClient({
    baseUrl: "https://lens.example",
    publicKey: "pk",
    secretKey: "sk",
    serviceName: "prompt-test",
    ...options,
  });
}

function textPrompt(
  overrides: {
    name?: string;
    version?: number;
    template?: string;
    config?: unknown;
    labels?: string[];
    selector?: unknown;
  } = {},
): Record<string, unknown> {
  return {
    name: "p",
    version: 1,
    type: "text",
    template: "Hello {{name}}",
    messages: null,
    config: {},
    labels: ["production"],
    selector: { label: "production" },
    ...overrides,
  };
}

function chatPrompt(overrides: { name?: string } = {}): Record<string, unknown> {
  return {
    name: "p",
    version: 1,
    type: "chat",
    template: null,
    messages: [{ role: "user", content: "Hi" }],
    config: {},
    labels: ["production"],
    selector: { label: "production" },
    ...overrides,
  };
}

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
