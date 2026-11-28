import { describe, expect, it, vi } from "vitest";
import {
  brave,
  exa,
  firecrawl,
  jina,
  perplexity,
  searxng,
  serper,
  tavily,
  webSearch,
} from "../src/tools/web-search";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("webSearch toolkit", () => {
  it("supports Tavily provider without leaking api_key in request body", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (url, init) => {
      expect(String(url)).toBe("https://api.tavily.com/search");
      expect(init?.method).toBe("POST");
      const headers = init?.headers as Record<string, string>;
      expect(headers.authorization).toBe("Bearer tvly-test");
      const parsed = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(parsed.api_key).toBeUndefined();
      expect(parsed.query).toBe("anvia ts");
      expect(parsed.max_results).toBe(3);

      return jsonResponse({
        answer: "Anvia is a TS AI runtime.",
        results: [
          {
            title: "Anvia Docs",
            url: "https://docs.anvia.dev",
            content: "Build provider-agnostic agents.",
            score: 0.95,
          },
        ],
      });
    });

    const kit = webSearch({
      provider: tavily({ apiKey: "tvly-test", includeAnswer: true, fetch: fetchMock }),
      maxResults: 3,
    });

    const result = (await kit.tools[0]!.call({ query: "anvia ts" })) as Record<string, unknown>;
    expect(result.provider).toBe("tavily");
    expect(result.answer).toBe("Anvia is a TS AI runtime.");
    expect(result.results).toEqual([
      {
        title: "Anvia Docs",
        url: "https://docs.anvia.dev",
        snippet: "Build provider-agnostic agents.",
        score: 0.95,
      },
    ]);
  });

  it("supports Exa, Brave, and SearxNG providers", async () => {
    const exaFetch = vi.fn<typeof fetch>(async (url, init) => {
      expect(String(url)).toBe("https://api.exa.ai/search");
      expect((init?.headers as Record<string, string>)["x-api-key"]).toBe("exa-key");
      return jsonResponse({
        results: [{ title: "Exa Result", url: "https://exa.ai", text: "Exa snippet" }],
      });
    });

    const exaKit = webSearch({ provider: exa({ apiKey: "exa-key", fetch: exaFetch }) });
    const exaRes = (await exaKit.tools[0]!.call({ query: "hello" })) as { results: unknown[] };
    expect(exaRes.results).toHaveLength(1);

    const braveFetch = vi.fn<typeof fetch>(async (url, init) => {
      expect(String(url)).toContain("api.search.brave.com/res/v1/web/search?q=hello&count=2");
      expect((init?.headers as Record<string, string>)["x-subscription-token"]).toBe("brave-key");
      return jsonResponse({
        web: { results: [{ title: "Brave", url: "https://brave.com", description: "Fast" }] },
      });
    });

    const braveKit = webSearch({
      provider: brave({ apiKey: "brave-key", fetch: braveFetch }),
      maxResults: 2,
    });
    const braveRes = (await braveKit.tools[0]!.call({ query: "hello" })) as { results: unknown[] };
    expect(braveRes.results).toHaveLength(1);

    const searxFetch = vi.fn<typeof fetch>(async (url) => {
      expect(String(url)).toContain("https://search.local/search?q=hello&format=json&engines=ddg");
      return jsonResponse({
        results: [{ title: "Searx", url: "https://example.org", content: "Open search" }],
      });
    });

    const searxKit = webSearch({
      provider: searxng({
        baseUrl: "https://search.local///",
        engines: ["ddg"],
        fetch: searxFetch,
      }),
    });
    const searxRes = (await searxKit.tools[0]!.call({ query: "hello" })) as { results: unknown[] };
    expect(searxRes.results).toHaveLength(1);
  });

  it("supports maxResults above 10 without explicit maxResultsLimit and slices custom provider overflow", async () => {
    const kit = webSearch({
      provider: {
        name: "custom",
        async search({ maxResults }) {
          return {
            results: Array.from({ length: maxResults + 5 }, (_, i) => ({
              title: `Result ${i}`,
              url: `https://example.com/${i}`,
              snippet: `Snippet ${i}`,
            })),
          };
        },
      },
      maxResults: 15,
    });

    const res = (await kit.tools[0]!.call({ query: "many" })) as { results: unknown[] };
    expect(res.results).toHaveLength(15);
  });

  it("supports Serper, Perplexity, Firecrawl, and Jina providers", async () => {
    const serperFetch = vi.fn<typeof fetch>(async (url, init) => {
      expect(String(url)).toBe("https://google.serper.dev/search");
      expect((init?.headers as Record<string, string>)["x-api-key"]).toBe("serper-key");
      return jsonResponse({
        answerBox: { answer: "42" },
        organic: [{ title: "Serper Hit", link: "https://serper.dev", snippet: "Fast Google API" }],
      });
    });
    const serperRes = (await webSearch({
      provider: serper({ apiKey: "serper-key", fetch: serperFetch }),
    }).tools[0]!.call({ query: "meaning" })) as { answer?: string; results: unknown[] };
    expect(serperRes.answer).toBe("42");
    expect(serperRes.results).toHaveLength(1);

    const pplxFetch = vi.fn<typeof fetch>(async (url, init) => {
      expect(String(url)).toBe("https://api.perplexity.ai/search");
      expect((init?.headers as Record<string, string>).authorization).toBe("Bearer pplx-key");
      return jsonResponse({
        results: [{ title: "Perplexity Hit", url: "https://perplexity.ai", snippet: "Grounded" }],
      });
    });
    const pplxRes = (await webSearch({
      provider: perplexity({ apiKey: "pplx-key", fetch: pplxFetch }),
    }).tools[0]!.call({ query: "ai" })) as { results: unknown[] };
    expect(pplxRes.results).toHaveLength(1);

    const fcFetch = vi.fn<typeof fetch>(async (url, init) => {
      expect(String(url)).toBe("https://api.firecrawl.dev/v1/search");
      expect((init?.headers as Record<string, string>).authorization).toBe("Bearer fc-key");
      return jsonResponse({
        data: [{ title: "Firecrawl Hit", url: "https://firecrawl.dev", markdown: "# Clean" }],
      });
    });
    const fcRes = (await webSearch({
      provider: firecrawl({ apiKey: "fc-key", fetch: fcFetch }),
    }).tools[0]!.call({ query: "crawl" })) as { results: { snippet: string }[] };
    expect(fcRes.results[0]!.snippet).toBe("# Clean");

    const jinaFetch = vi.fn<typeof fetch>(async (url, init) => {
      expect(String(url)).toBe("https://s.jina.ai/?q=reader");
      expect((init?.headers as Record<string, string>).authorization).toBe("Bearer jina-key");
      return jsonResponse({
        data: [{ title: "Jina Hit", url: "https://jina.ai", description: "Readable" }],
      });
    });
    const jinaRes = (await webSearch({
      provider: jina({ apiKey: "jina-key", fetch: jinaFetch }),
    }).tools[0]!.call({ query: "reader" })) as { results: unknown[] };
    expect(jinaRes.results).toHaveLength(1);
  });

  it("throws informative errors on HTTP failure", async () => {
    const badFetch = vi.fn<typeof fetch>(
      async () => new Response("invalid api key", { status: 401, statusText: "Unauthorized" }),
    );
    const kit = webSearch({ provider: tavily({ apiKey: "bad", fetch: badFetch }) });
    await expect(kit.tools[0]!.call({ query: "test" })).rejects.toThrow(/401 Unauthorized/);
  });
});
