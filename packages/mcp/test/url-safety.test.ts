import type { LookupAddress } from "node:dns";
import type { LookupFunction } from "node:net";
import type { Dispatcher } from "undici";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createBoundedMcpFetch,
  createSafeMcpFetch,
  createSafeMcpLookup,
  parseAndValidateMcpUrl,
  resolveAndValidateMcpHostname,
} from "../src/url-safety.js";

const undici = vi.hoisted(() => ({
  fetch: vi.fn(),
}));

vi.mock("undici", async (importOriginal) => {
  const actual = await importOriginal<typeof import("undici")>();
  return {
    ...actual,
    fetch: undici.fetch,
  };
});

describe("MCP connection SSRF protection", () => {
  describe("URL validation", () => {
    it.each(["https://api.example.com/mcp", "http://93.184.216.34/mcp"])(
      "allows public HTTP(S) URL %s",
      (url) => {
        expect(parseAndValidateMcpUrl(url).href).toBe(url);
      },
    );

    it.each([
      ["http://localhost:3000/mcp", "localhost not allowed"],
      ["http://localhost.:3000/mcp", "localhost not allowed"],
      ["http://server.localhost/mcp", "localhost not allowed"],
      ["http://127.1.2.3/mcp", "localhost not allowed"],
      ["http://10.0.0.1/mcp", "private IP range not allowed"],
      ["http://100.100.100.200/mcp", "private IP range not allowed"],
      ["http://169.254.169.254/latest/meta-data", "cloud metadata endpoint not allowed"],
      ["http://192.168.1.1/mcp", "private IP range not allowed"],
      ["http://[::]/mcp", "private IPv6 range not allowed"],
      ["http://[::1]/mcp", "localhost not allowed"],
      ["http://[::ffff:127.0.0.1]/mcp", "private IPv6 range not allowed"],
      ["http://[fd12::1]/mcp", "private IPv6 range not allowed"],
      ["http://[fe90::1]/mcp", "private IPv6 range not allowed"],
      ["http://[fd00:ec2::254]/mcp", "cloud metadata endpoint not allowed"],
    ])("blocks non-public URL %s", (url, message) => {
      expect(() => parseAndValidateMcpUrl(url)).toThrow(message);
    });

    it.each(["file:///etc/passwd", "ftp://api.example.com/mcp", "not-a-url"])(
      "rejects unsupported or malformed URL %s",
      (url) => {
        expect(() => parseAndValidateMcpUrl(url)).toThrow();
      },
    );
  });

  describe("DNS validation", () => {
    it("allows and returns public DNS results for connection pinning", async () => {
      const addresses: LookupAddress[] = [
        { address: "93.184.216.34", family: 4 },
        { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
      ];
      const resolver = vi.fn(async () => addresses);

      await expect(resolveAndValidateMcpHostname("API.EXAMPLE.COM.", resolver)).resolves.toEqual(
        addresses,
      );
      expect(resolver).toHaveBeenCalledWith("api.example.com");
    });

    it("rejects a hostname when any DNS result is non-public", async () => {
      const resolver = vi.fn(async () => [
        { address: "93.184.216.34", family: 4 as const },
        { address: "10.0.0.1", family: 4 as const },
      ]);

      await expect(resolveAndValidateMcpHostname("attacker.example", resolver)).rejects.toThrow(
        "private IP range not allowed",
      );
    });

    it("rejects hostnames that resolve to IPv4-mapped loopback", async () => {
      const resolver = vi.fn(async () => [{ address: "::ffff:127.0.0.1", family: 6 as const }]);

      await expect(resolveAndValidateMcpHostname("attacker.example", resolver)).rejects.toThrow(
        "private IPv6 range not allowed",
      );
    });

    it("returns the validated DNS results from the socket lookup", async () => {
      const addresses: LookupAddress[] = [
        { address: "93.184.216.34", family: 4 },
        { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
      ];
      const safeLookup = createSafeMcpLookup(async () => addresses);

      await expect(runLookup(safeLookup, "api.example.com")).resolves.toEqual(addresses);
    });
  });

  describe("safe fetch", () => {
    beforeEach(() => {
      undici.fetch.mockReset();
    });

    it("executes accepted public requests with the safe dispatcher", async () => {
      const response = new Response(null, { status: 204 });
      undici.fetch.mockResolvedValue(response);
      const safeFetch = createSafeMcpFetch();

      await expect(safeFetch("https://93.184.216.34/mcp")).resolves.toBe(response);
      expect(undici.fetch).toHaveBeenCalledOnce();
      expect(undici.fetch.mock.calls[0]?.[1]).toHaveProperty("dispatcher");
    });

    it("rejects a private request before invoking Undici", () => {
      const safeFetch = createSafeMcpFetch();

      expect(() => safeFetch("http://[fd12::1]/mcp")).toThrow("private IPv6 range not allowed");
      expect(undici.fetch).not.toHaveBeenCalled();
    });

    it.each(["http://127.0.0.1/mcp", "http://169.254.169.254/mcp", "http://[fd12::1]/mcp"])(
      "revalidates redirect destination %s through the safe dispatcher",
      async (location) => {
        const actual = await vi.importActual<typeof import("undici")>("undici");
        const origin = "https://api.example.com";
        const mock = new actual.MockAgent();
        mock.disableNetConnect();
        mock.get(origin).intercept({ path: "/mcp" }).reply(302, "", { headers: { location } });
        const destinations: string[] = [];
        undici.fetch.mockImplementation((url, init) => {
          const safeDispatcher = init.dispatcher as Dispatcher;
          // Serve the public origin without network I/O; redirects use the real safe dispatcher.
          return actual.fetch(url, {
            ...init,
            dispatcher: {
              dispatch(options, handler) {
                destinations.push(String(options.origin));
                return (String(options.origin) === origin ? mock : safeDispatcher).dispatch(
                  options,
                  handler,
                );
              },
            } as Dispatcher,
          });
        });
        try {
          await expect(createSafeMcpFetch()(`${origin}/mcp`)).rejects.toMatchObject({
            cause: { message: expect.stringContaining("MCP URL blocked") },
          });
          expect(destinations).toEqual([origin, new URL(location).origin]);
        } finally {
          await mock.close();
        }
      },
    );
  });
});

function runLookup(lookup: LookupFunction, hostname: string): Promise<LookupAddress[]> {
  return new Promise((resolve, reject) => {
    lookup(hostname, { all: true }, (error, addresses) => {
      if (error) {
        reject(error);
        return;
      }
      if (!Array.isArray(addresses)) {
        reject(new TypeError("Expected lookup to return all addresses."));
        return;
      }
      resolve(addresses);
    });
  });
}

describe("bounded MCP fetch", () => {
  const limit = 16;

  it("passes a response under the limit through unchanged", async () => {
    const response = new Response('{"ok":1}', {
      status: 200,
      headers: { "content-type": "application/json", "content-length": "8" },
    });
    const boundedFetch = createBoundedMcpFetch(async () => response, limit);

    const limited = await boundedFetch("https://api.example.com/mcp");
    expect(limited.status).toBe(200);
    expect(limited.headers.get("content-type")).toBe("application/json");
    await expect(limited.text()).resolves.toBe('{"ok":1}');
  });

  it("rejects eagerly when content-length exceeds maxBufferSize", async () => {
    const response = new Response("x".repeat(32), {
      headers: { "content-type": "application/json", "content-length": "32" },
    });
    const boundedFetch = createBoundedMcpFetch(async () => response, limit);

    await expect(boundedFetch("https://api.example.com/mcp")).rejects.toThrow(/maxBufferSize/);
  });

  it("errors while reading a chunked body that exceeds maxBufferSize", async () => {
    const response = new Response(
      createChunkedStream(["x".repeat(8), "x".repeat(8), "x".repeat(8)]),
      {
        headers: { "content-type": "application/json" },
      },
    );
    const boundedFetch = createBoundedMcpFetch(async () => response, limit);

    const limited = await boundedFetch("https://api.example.com/mcp");
    await expect(limited.text()).rejects.toThrow(/maxBufferSize/);
  });

  it("allows event streams whose individual events stay within maxBufferSize", async () => {
    const events = 'data: {"a":1}\n\ndata: {"b":2}\n\n';
    const response = new Response(events, {
      headers: {
        "content-type": "text/event-stream",
        "content-length": String(events.length),
      },
    });
    const boundedFetch = createBoundedMcpFetch(async () => response, 15);

    const limited = await boundedFetch("https://api.example.com/mcp");
    await expect(limited.text()).resolves.toBe(events);
  });

  it("errors when a single event-stream event exceeds maxBufferSize", async () => {
    const response = new Response('data: {"too":"long"}\n\n', {
      headers: { "content-type": "text/event-stream" },
    });
    const boundedFetch = createBoundedMcpFetch(async () => response, 10);

    const limited = await boundedFetch("https://api.example.com/mcp");
    await expect(limited.text()).rejects.toThrow(/maxBufferSize/);
  });

  it("resets the event budget at boundaries that straddle chunk edges", async () => {
    const firstEvent = "data: 123456789\r\n\r\n";
    const secondEvent = "data: 987654321\r\n\r\n";
    const response = new Response(
      createChunkedStream([firstEvent.slice(0, -1), `\n${secondEvent}`]),
      { headers: { "content-type": "text/event-stream" } },
    );
    const boundedFetch = createBoundedMcpFetch(async () => response, firstEvent.length);

    const limited = await boundedFetch("https://api.example.com/mcp");
    await expect(limited.text()).resolves.toBe(firstEvent + secondEvent);
  });

  it("resets the event budget for CR-only and mixed line endings", async () => {
    const events = ["data: 1234\r\r", "data: 5678\r\n\n", "data: 9012\n\r\n"];
    const stream = events.join("");
    const response = new Response(createChunkedStream([...stream]), {
      headers: { "content-type": "text/event-stream" },
    });
    const boundedFetch = createBoundedMcpFetch(
      async () => response,
      Math.max(...events.map((event) => event.length)),
    );

    const limited = await boundedFetch("https://api.example.com/mcp");
    await expect(limited.text()).resolves.toBe(stream);
  });

  it("errors when an event that straddles chunk edges exceeds maxBufferSize", async () => {
    const event = `data: ${"x".repeat(16)}\r\n\r\n`;
    const response = new Response(createChunkedStream([event.slice(0, 15), event.slice(15)]), {
      headers: { "content-type": "text/event-stream" },
    });
    const boundedFetch = createBoundedMcpFetch(async () => response, 15);

    const limited = await boundedFetch("https://api.example.com/mcp");
    await expect(limited.text()).rejects.toThrow(/maxBufferSize/);
  });
});

function createChunkedStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}
