import { describe, expect, it, vi } from "vitest";
import { webFetch } from "../src/tools/web-fetch";

const publicResolver = async () => [{ address: "93.184.216.34", family: 4 }];

describe("webFetch toolkit", () => {
  it("converts HTML to readable text, strips scripts including truncated ones, and extracts title", async () => {
    const html = `
      <!doctype html>
      <html>
        <head>
          <title>Anvia &amp; Extensions</title>
          <style>.hidden { display: none; }</style>
        </head>
        <body>
          <h1>Welcome</h1>
          <script>alert("secret")</script >
          <p>Hello world from Anvia.</p>
          <ul><li>First item</li><li>Second item</li></ul>
          <script>const unclosedLeak = "hidden"
        </body>
      </html>
    `;
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(html, {
          status: 200,
          headers: { "content-type": "Text/HTML; charset=utf-8" },
        }),
    );

    const kit = webFetch({
      allowedHosts: ["docs.anvia.dev"],
      resolveAddress: publicResolver,
      fetch: fetchMock,
      maxChars: 500,
    });

    const result = (await kit.tools[0]!.call({ url: "https://docs.anvia.dev/guide" })) as {
      title?: string;
      content: string;
      truncated: boolean;
    };

    expect(result.title).toBe("Anvia & Extensions");
    expect(result.content).toContain("# Welcome");
    expect(result.content).toContain("Hello world from Anvia.");
    expect(result.content).toContain("- First item");
    expect(result.content).not.toContain("alert");
    expect(result.content).not.toContain("unclosedLeak");
    expect(result.content).not.toContain(".hidden");
    expect(result.truncated).toBe(false);
  });

  it("blocks private IPs, trailing-dot FQDNs, empty allowedHosts, and SSRF redirects", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (url) => {
      if (String(url) === "https://public.example.com/redir") {
        return new Response(null, {
          status: 302,
          headers: { location: "http://169.254.169.254/latest/meta-data" },
        });
      }

      return new Response("ok", { status: 200 });
    });

    const kit = webFetch({
      blockedHosts: ["evil.com"],
      resolveAddress: async (hostname) =>
        hostname === "internal.evil.org"
          ? [{ address: "127.0.0.1", family: 4 }]
          : [{ address: "93.184.216.34", family: 4 }],
      fetch: fetchMock,
    });

    await expect(kit.tools[0]!.call({ url: "http://localhost:3000" })).rejects.toThrow(/blocked/);
    await expect(kit.tools[0]!.call({ url: "http://localhost./" })).rejects.toThrow(/blocked/);
    await expect(kit.tools[0]!.call({ url: "https://evil.com./" })).rejects.toThrow(/blocked/);
    await expect(kit.tools[0]!.call({ url: "http://127.0.0.1/admin" })).rejects.toThrow(/blocked/);
    await expect(kit.tools[0]!.call({ url: "https://internal.evil.org/" })).rejects.toThrow(
      /resolved to blocked private address/,
    );
    await expect(kit.tools[0]!.call({ url: "https://public.example.com/redir" })).rejects.toThrow(
      /blocked/,
    );
    await expect(kit.tools[0]!.call({ url: "file:///etc/passwd" })).rejects.toThrow(
      /only http: and https:/,
    );

    const closedKit = webFetch({
      allowedHosts: [],
      resolveAddress: publicResolver,
      fetch: fetchMock,
    });
    await expect(closedKit.tools[0]!.call({ url: "https://example.com" })).rejects.toThrow(
      /allowedHosts/,
    );
  });

  it("strips credentials on cross-origin redirects and blocks https->http downgrade with auth headers", async () => {
    const seenHeaders: Array<Record<string, string>> = [];
    const fetchMock = vi.fn<typeof fetch>(async (url, init) => {
      seenHeaders.push((init?.headers ?? {}) as Record<string, string>);

      if (String(url) === "https://a.example.com/start") {
        return new Response(null, {
          status: 302,
          headers: { location: "https://b.example.com/final" },
        });
      }

      if (String(url) === "https://a.example.com/downgrade") {
        return new Response(null, {
          status: 302,
          headers: { location: "http://a.example.com/plain" },
        });
      }

      return new Response("done", { status: 200 });
    });

    const kit = webFetch({
      headers: { Authorization: "Bearer secret-token", "X-Api-Key": "k123" },
      resolveAddress: publicResolver,
      fetch: fetchMock,
    });

    await kit.tools[0]!.call({ url: "https://a.example.com/start" });
    expect(seenHeaders[0]?.authorization).toBe("Bearer secret-token");
    expect(seenHeaders[0]?.["x-api-key"]).toBe("k123");
    expect(seenHeaders[1]?.authorization).toBeUndefined();
    expect(seenHeaders[1]?.["x-api-key"]).toBeUndefined();

    await expect(kit.tools[0]!.call({ url: "https://a.example.com/downgrade" })).rejects.toThrow(
      /downgrades from https: to http:/,
    );
  });

  it("enforces maxBytes cap on oversized responses", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response("a".repeat(200), {
          status: 200,
          headers: { "content-type": "text/plain" },
        }),
    );

    const kit = webFetch({
      resolveAddress: publicResolver,
      fetch: fetchMock,
      maxBytes: 40,
      maxChars: 100,
    });

    const result = (await kit.tools[0]!.call({ url: "https://example.com/big.txt" })) as {
      content: string;
      truncated: boolean;
    };
    expect(result.content.length).toBe(40);
    expect(result.truncated).toBe(true);
  });
});
