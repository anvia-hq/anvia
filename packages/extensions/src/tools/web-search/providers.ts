import { z } from "zod";
import { parseHttpUrl } from "../../internal/url-safety";
import type { WebSearchProvider, WebSearchResult } from "./types";

type FetchLike = typeof globalThis.fetch;

const DEFAULT_PROVIDER_TIMEOUT_MS = 15_000;
const MAX_PROVIDER_RESPONSE_BYTES = 2_000_000;

export type TavilyProviderOptions = {
  apiKey: string;
  baseUrl?: string | undefined;
  searchDepth?: "basic" | "advanced" | undefined;
  topic?: "general" | "news" | undefined;
  includeAnswer?: boolean | undefined;
  timeoutMs?: number | undefined;
  fetch?: FetchLike | undefined;
};

export type ExaProviderOptions = {
  apiKey: string;
  baseUrl?: string | undefined;
  type?: "auto" | "neural" | "keyword" | undefined;
  includeText?: boolean | undefined;
  maxCharacters?: number | undefined;
  timeoutMs?: number | undefined;
  fetch?: FetchLike | undefined;
};

export type BraveProviderOptions = {
  apiKey: string;
  baseUrl?: string | undefined;
  country?: string | undefined;
  searchLang?: string | undefined;
  timeoutMs?: number | undefined;
  fetch?: FetchLike | undefined;
};

export type SearxngProviderOptions = {
  baseUrl: string;
  engines?: readonly string[] | undefined;
  categories?: readonly string[] | undefined;
  language?: string | undefined;
  headers?: Record<string, string> | undefined;
  timeoutMs?: number | undefined;
  fetch?: FetchLike | undefined;
};

export type SerperProviderOptions = {
  apiKey: string;
  baseUrl?: string | undefined;
  gl?: string | undefined;
  hl?: string | undefined;
  timeoutMs?: number | undefined;
  fetch?: FetchLike | undefined;
};

export type PerplexityProviderOptions = {
  apiKey: string;
  baseUrl?: string | undefined;
  country?: string | undefined;
  maxTokensPerPage?: number | undefined;
  timeoutMs?: number | undefined;
  fetch?: FetchLike | undefined;
};

export type FirecrawlProviderOptions = {
  apiKey: string;
  baseUrl?: string | undefined;
  lang?: string | undefined;
  country?: string | undefined;
  timeoutMs?: number | undefined;
  fetch?: FetchLike | undefined;
};

export type JinaProviderOptions = {
  apiKey?: string | undefined;
  baseUrl?: string | undefined;
  timeoutMs?: number | undefined;
  fetch?: FetchLike | undefined;
};

const nullableString = z
  .string()
  .nullish()
  .transform((value) => value ?? "");

const tavilyResponseSchema = z.object({
  answer: z.string().nullish(),
  results: z
    .array(
      z.object({
        title: nullableString,
        url: z.string(),
        content: nullableString,
        score: z.number().nullish(),
        published_date: z.string().nullish(),
      }),
    )
    .nullish()
    .transform((value) => value ?? []),
});

const exaResponseSchema = z.object({
  results: z
    .array(
      z.object({
        title: z.string().nullish(),
        url: z.string(),
        text: z.string().nullish(),
        highlights: z.array(z.string()).nullish(),
        score: z.number().nullish(),
        publishedDate: z.string().nullish(),
      }),
    )
    .nullish()
    .transform((value) => value ?? []),
});

const braveResponseSchema = z.object({
  web: z
    .object({
      results: z
        .array(
          z.object({
            title: nullableString,
            url: z.string(),
            description: nullableString,
            age: z.string().nullish(),
          }),
        )
        .nullish()
        .transform((value) => value ?? []),
    })
    .nullish(),
});

const searxngResponseSchema = z.object({
  results: z
    .array(
      z.object({
        title: nullableString,
        url: z.string(),
        content: z.string().nullish(),
        score: z.number().nullish(),
        publishedDate: z.string().nullish(),
      }),
    )
    .nullish()
    .transform((value) => value ?? []),
});

const serperResponseSchema = z.object({
  answerBox: z
    .object({
      answer: z.string().nullish(),
      snippet: z.string().nullish(),
    })
    .nullish(),
  organic: z
    .array(
      z.object({
        title: nullableString,
        link: z.string(),
        snippet: nullableString,
        date: z.string().nullish(),
      }),
    )
    .nullish()
    .transform((value) => value ?? []),
});

const perplexityResponseSchema = z.object({
  results: z
    .array(
      z.object({
        title: nullableString,
        url: z.string(),
        snippet: nullableString,
        date: z.string().nullish(),
      }),
    )
    .nullish()
    .transform((value) => value ?? []),
});

const firecrawlResponseSchema = z.object({
  data: z
    .array(
      z.object({
        title: z.string().nullish(),
        url: z.string(),
        description: z.string().nullish(),
        markdown: z.string().nullish(),
      }),
    )
    .nullish()
    .transform((value) => value ?? []),
});

const jinaResponseSchema = z.object({
  data: z
    .array(
      z.object({
        title: z.string().nullish(),
        url: z.string(),
        description: z.string().nullish(),
        content: z.string().nullish(),
        date: z.string().nullish(),
      }),
    )
    .nullish()
    .transform((value) => value ?? []),
});

export function tavily(options: TavilyProviderOptions): WebSearchProvider {
  const apiKey = assertNonEmpty(options.apiKey, "Tavily apiKey");
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? "https://api.tavily.com");
  const endpoint = `${baseUrl}/search`;
  const timeoutMs = validateTimeoutMs(options.timeoutMs);
  const fetchImpl = options.fetch ?? globalThis.fetch;

  return {
    name: "tavily",
    async search({ query, maxResults, abortSignal }) {
      const payload = await fetchAndParseJson(
        fetchImpl,
        endpoint,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            query,
            max_results: maxResults,
            search_depth: options.searchDepth ?? "basic",
            topic: options.topic ?? "general",
            include_answer: options.includeAnswer ?? false,
          }),
        },
        timeoutMs,
        abortSignal,
        "Tavily",
        tavilyResponseSchema,
      );

      const results: WebSearchResult[] = payload.results.slice(0, maxResults).map((item) => {
        const entry: WebSearchResult = {
          title: item.title,
          url: item.url,
          snippet: item.content,
        };

        if (item.score !== undefined && item.score !== null) entry.score = item.score;

        if (item.published_date) entry.publishedDate = item.published_date;

        return entry;
      });

      const out: { results: WebSearchResult[]; answer?: string } = { results };

      if (payload.answer) out.answer = payload.answer;

      return out;
    },
  };
}

export function exa(options: ExaProviderOptions): WebSearchProvider {
  const apiKey = assertNonEmpty(options.apiKey, "Exa apiKey");
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? "https://api.exa.ai");
  const endpoint = `${baseUrl}/search`;
  const timeoutMs = validateTimeoutMs(options.timeoutMs);
  const fetchImpl = options.fetch ?? globalThis.fetch;

  return {
    name: "exa",
    async search({ query, maxResults, abortSignal }) {
      const includeText = options.includeText ?? true;
      const body: Record<string, unknown> = {
        query,
        numResults: maxResults,
        type: options.type ?? "auto",
      };

      if (includeText) {
        body.contents = {
          text:
            options.maxCharacters !== undefined ? { maxCharacters: options.maxCharacters } : true,
        };
      }

      const payload = await fetchAndParseJson(
        fetchImpl,
        endpoint,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": apiKey,
          },
          body: JSON.stringify(body),
        },
        timeoutMs,
        abortSignal,
        "Exa",
        exaResponseSchema,
      );

      const results: WebSearchResult[] = payload.results.slice(0, maxResults).map((item) => {
        const entry: WebSearchResult = {
          title: nonEmptyOr(item.title, item.url),
          url: item.url,
          snippet: nonEmptyOr(item.text, item.highlights?.join("\n") ?? ""),
        };

        if (item.score !== undefined && item.score !== null) entry.score = item.score;

        if (item.publishedDate) entry.publishedDate = item.publishedDate;

        return entry;
      });

      return { results };
    },
  };
}

export function brave(options: BraveProviderOptions): WebSearchProvider {
  const apiKey = assertNonEmpty(options.apiKey, "Brave apiKey");
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? "https://api.search.brave.com/res/v1");
  const timeoutMs = validateTimeoutMs(options.timeoutMs);
  const fetchImpl = options.fetch ?? globalThis.fetch;

  return {
    name: "brave",
    async search({ query, maxResults, abortSignal }) {
      const url = new URL(`${baseUrl}/web/search`);
      url.searchParams.set("q", query);
      url.searchParams.set("count", String(maxResults));

      if (options.country !== undefined) url.searchParams.set("country", options.country);

      if (options.searchLang !== undefined) url.searchParams.set("search_lang", options.searchLang);

      const payload = await fetchAndParseJson(
        fetchImpl,
        url.toString(),
        {
          method: "GET",
          headers: {
            accept: "application/json",
            "x-subscription-token": apiKey,
          },
        },
        timeoutMs,
        abortSignal,
        "Brave",
        braveResponseSchema,
      );

      const results: WebSearchResult[] = (payload.web?.results ?? [])
        .slice(0, maxResults)
        .map((item) => {
          const entry: WebSearchResult = {
            title: item.title,
            url: item.url,
            snippet: item.description,
          };

          if (item.age) entry.publishedDate = item.age;

          return entry;
        });

      return { results };
    },
  };
}

export function searxng(options: SearxngProviderOptions): WebSearchProvider {
  const baseUrl = normalizeBaseUrl(assertNonEmpty(options.baseUrl, "SearxNG baseUrl"));
  const timeoutMs = validateTimeoutMs(options.timeoutMs);
  const fetchImpl = options.fetch ?? globalThis.fetch;

  return {
    name: "searxng",
    async search({ query, maxResults, abortSignal }) {
      const url = new URL(`${baseUrl}/search`);
      url.searchParams.set("q", query);
      url.searchParams.set("format", "json");

      if (options.engines !== undefined && options.engines.length > 0) {
        url.searchParams.set("engines", options.engines.join(","));
      }

      if (options.categories !== undefined && options.categories.length > 0) {
        url.searchParams.set("categories", options.categories.join(","));
      }

      if (options.language !== undefined) {
        url.searchParams.set("language", options.language);
      }

      const payload = await fetchAndParseJson(
        fetchImpl,
        url.toString(),
        {
          method: "GET",
          headers: {
            accept: "application/json",
            ...options.headers,
          },
        },
        timeoutMs,
        abortSignal,
        "SearxNG",
        searxngResponseSchema,
      );

      const results: WebSearchResult[] = payload.results.slice(0, maxResults).map((item) => {
        const entry: WebSearchResult = {
          title: item.title,
          url: item.url,
          snippet: item.content ?? "",
        };

        if (item.score !== undefined && item.score !== null) entry.score = item.score;

        if (item.publishedDate) entry.publishedDate = item.publishedDate;

        return entry;
      });

      return { results };
    },
  };
}

export function serper(options: SerperProviderOptions): WebSearchProvider {
  const apiKey = assertNonEmpty(options.apiKey, "Serper apiKey");
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? "https://google.serper.dev");
  const endpoint = `${baseUrl}/search`;
  const timeoutMs = validateTimeoutMs(options.timeoutMs);
  const fetchImpl = options.fetch ?? globalThis.fetch;

  return {
    name: "serper",
    async search({ query, maxResults, abortSignal }) {
      const body: Record<string, unknown> = {
        q: query,
        num: maxResults,
      };

      if (options.gl !== undefined) body.gl = options.gl;

      if (options.hl !== undefined) body.hl = options.hl;

      const payload = await fetchAndParseJson(
        fetchImpl,
        endpoint,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": apiKey,
          },
          body: JSON.stringify(body),
        },
        timeoutMs,
        abortSignal,
        "Serper",
        serperResponseSchema,
      );

      const results: WebSearchResult[] = payload.organic.slice(0, maxResults).map((item) => {
        const entry: WebSearchResult = {
          title: item.title,
          url: item.link,
          snippet: item.snippet,
        };

        if (item.date) entry.publishedDate = item.date;

        return entry;
      });

      const out: { results: WebSearchResult[]; answer?: string } = { results };
      const answer = nonEmptyOr(payload.answerBox?.answer, payload.answerBox?.snippet ?? "");

      if (answer.length > 0) out.answer = answer;

      return out;
    },
  };
}

export function perplexity(options: PerplexityProviderOptions): WebSearchProvider {
  const apiKey = assertNonEmpty(options.apiKey, "Perplexity apiKey");
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? "https://api.perplexity.ai");
  const endpoint = `${baseUrl}/search`;
  const timeoutMs = validateTimeoutMs(options.timeoutMs);
  const fetchImpl = options.fetch ?? globalThis.fetch;

  if (
    options.maxTokensPerPage !== undefined &&
    (!Number.isSafeInteger(options.maxTokensPerPage) || options.maxTokensPerPage <= 0)
  ) {
    throw new RangeError("Perplexity maxTokensPerPage must be a positive safe integer.");
  }

  return {
    name: "perplexity",
    async search({ query, maxResults, abortSignal }) {
      const body: Record<string, unknown> = {
        query,
        max_results: maxResults,
      };

      if (options.country !== undefined) body.country = options.country;

      if (options.maxTokensPerPage !== undefined) {
        body.max_tokens_per_page = options.maxTokensPerPage;
      }

      const payload = await fetchAndParseJson(
        fetchImpl,
        endpoint,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
        },
        timeoutMs,
        abortSignal,
        "Perplexity",
        perplexityResponseSchema,
      );

      const results: WebSearchResult[] = payload.results.slice(0, maxResults).map((item) => {
        const entry: WebSearchResult = {
          title: item.title,
          url: item.url,
          snippet: item.snippet,
        };

        if (item.date) entry.publishedDate = item.date;

        return entry;
      });

      return { results };
    },
  };
}

export function firecrawl(options: FirecrawlProviderOptions): WebSearchProvider {
  const apiKey = assertNonEmpty(options.apiKey, "Firecrawl apiKey");
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? "https://api.firecrawl.dev/v1");
  const endpoint = `${baseUrl}/search`;
  const timeoutMs = validateTimeoutMs(options.timeoutMs);
  const fetchImpl = options.fetch ?? globalThis.fetch;

  return {
    name: "firecrawl",
    async search({ query, maxResults, abortSignal }) {
      const body: Record<string, unknown> = {
        query,
        limit: maxResults,
      };

      if (options.lang !== undefined) body.lang = options.lang;

      if (options.country !== undefined) body.country = options.country;

      const payload = await fetchAndParseJson(
        fetchImpl,
        endpoint,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
        },
        timeoutMs,
        abortSignal,
        "Firecrawl",
        firecrawlResponseSchema,
      );

      const results: WebSearchResult[] = payload.data.slice(0, maxResults).map((item) => ({
        title: nonEmptyOr(item.title, item.url),
        url: item.url,
        snippet: nonEmptyOr(item.description, item.markdown ?? ""),
      }));

      return { results };
    },
  };
}

export function jina(options: JinaProviderOptions = {}): WebSearchProvider {
  const apiKey =
    options.apiKey === undefined ? undefined : assertNonEmpty(options.apiKey, "Jina apiKey");
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? "https://s.jina.ai");
  const timeoutMs = validateTimeoutMs(options.timeoutMs);
  const fetchImpl = options.fetch ?? globalThis.fetch;

  return {
    name: "jina",
    async search({ query, maxResults, abortSignal }) {
      const url = new URL(`${baseUrl}/`);
      url.searchParams.set("q", query);

      const headers: Record<string, string> = {
        accept: "application/json",
      };

      if (apiKey !== undefined) {
        headers.authorization = `Bearer ${apiKey}`;
      }

      const payload = await fetchAndParseJson(
        fetchImpl,
        url.toString(),
        {
          method: "GET",
          headers,
        },
        timeoutMs,
        abortSignal,
        "Jina",
        jinaResponseSchema,
      );

      const results: WebSearchResult[] = payload.data.slice(0, maxResults).map((item) => {
        const entry: WebSearchResult = {
          title: nonEmptyOr(item.title, item.url),
          url: item.url,
          snippet: nonEmptyOr(item.description, item.content ?? ""),
        };

        if (item.date) entry.publishedDate = item.date;

        return entry;
      });

      return { results };
    },
  };
}

async function fetchAndParseJson<T>(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  abortSignal: AbortSignal | undefined,
  providerName: string,
  schema: z.ZodType<T>,
): Promise<T> {
  const controller = new AbortController();
  const timeoutError = new Error(`Search request timed out after ${timeoutMs}ms.`);
  const timer = setTimeout(() => controller.abort(timeoutError), timeoutMs);
  timer.unref();
  const signal =
    abortSignal === undefined
      ? controller.signal
      : AbortSignal.any([abortSignal, controller.signal]);

  try {
    const response = await fetchImpl(url, {
      ...init,
      redirect: "error",
      signal,
    });
    const bodyText = await readBoundedBody(response, MAX_PROVIDER_RESPONSE_BYTES, signal);

    if (!response.ok) {
      throw new Error(
        `${providerName} search failed (${response.status} ${response.statusText})${bodyText ? `: ${bodyText.slice(0, 300)}` : ""}`,
      );
    }

    let json: unknown;
    try {
      json = JSON.parse(bodyText);
    } catch {
      throw new Error(`${providerName} search returned invalid JSON: ${bodyText.slice(0, 200)}`);
    }

    return schema.parse(json);
  } finally {
    clearTimeout(timer);
  }
}

async function readBoundedBody(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
): Promise<string> {
  if (response.body === null) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  const onAbort = (): void => {
    void reader.cancel(signal.reason).catch(() => undefined);
  };
  signal.addEventListener("abort", onAbort, { once: true });

  try {
    while (true) {
      if (signal.aborted) {
        const reason = signal.reason;
        throw reason instanceof Error ? reason : new Error("Search response body read aborted.");
      }

      const { done, value } = await reader.read();

      if (done) break;

      if (value === undefined) continue;

      if (totalBytes + value.byteLength > maxBytes) {
        await reader.cancel();
        throw new Error(`Search provider response exceeded ${maxBytes} bytes.`);
      }

      chunks.push(value);
      totalBytes += value.byteLength;
    }
  } finally {
    signal.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }

  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(combined);
}

function nonEmptyOr(primary: string | null | undefined, fallback: string): string {
  if (primary !== undefined && primary !== null && primary.trim().length > 0) {
    return primary;
  }

  return fallback;
}

function assertNonEmpty(value: string, label: string): string {
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    throw new TypeError(`${label} must not be empty.`);
  }

  return trimmed;
}

function normalizeBaseUrl(rawUrl: string): string {
  const parsed = parseHttpUrl(rawUrl);
  return parsed.toString().replace(/\/+$/, "");
}

function validateTimeoutMs(timeoutMs: number | undefined): number {
  const resolved = timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS;

  if (!Number.isFinite(resolved) || resolved <= 0) {
    throw new RangeError("Search provider timeoutMs must be a positive finite number.");
  }

  return resolved;
}
