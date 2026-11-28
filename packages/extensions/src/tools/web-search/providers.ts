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

const tavilyResponseSchema = z.object({
  answer: z.string().nullish(),
  results: z
    .array(
      z.object({
        title: z.string().default(""),
        url: z.string(),
        content: z.string().default(""),
        score: z.number().optional(),
        published_date: z.string().nullish(),
      }),
    )
    .default([]),
});

const exaResponseSchema = z.object({
  results: z
    .array(
      z.object({
        title: z.string().nullish(),
        url: z.string(),
        text: z.string().nullish(),
        highlights: z.array(z.string()).nullish(),
        score: z.number().optional(),
        publishedDate: z.string().nullish(),
      }),
    )
    .default([]),
});

const braveResponseSchema = z.object({
  web: z
    .object({
      results: z
        .array(
          z.object({
            title: z.string().default(""),
            url: z.string(),
            description: z.string().default(""),
            age: z.string().optional(),
          }),
        )
        .default([]),
    })
    .optional(),
});

const searxngResponseSchema = z.object({
  results: z
    .array(
      z.object({
        title: z.string().default(""),
        url: z.string(),
        content: z.string().nullish(),
        score: z.number().optional(),
        publishedDate: z.string().nullish(),
      }),
    )
    .default([]),
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
      const response = await fetchWithTimeout(
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
      );

      const payload = await parseJsonResponse(response, "Tavily", tavilyResponseSchema);
      const results: WebSearchResult[] = payload.results.slice(0, maxResults).map((item) => {
        const entry: WebSearchResult = {
          title: item.title,
          url: item.url,
          snippet: item.content,
        };

        if (item.score !== undefined) entry.score = item.score;

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

      const response = await fetchWithTimeout(
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
      );

      const payload = await parseJsonResponse(response, "Exa", exaResponseSchema);
      const results: WebSearchResult[] = payload.results.slice(0, maxResults).map((item) => {
        const entry: WebSearchResult = {
          title: item.title ?? item.url,
          url: item.url,
          snippet: item.text ?? item.highlights?.join("\n") ?? "",
        };

        if (item.score !== undefined) entry.score = item.score;

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

      const response = await fetchWithTimeout(
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
      );

      const payload = await parseJsonResponse(response, "Brave", braveResponseSchema);
      const results: WebSearchResult[] = (payload.web?.results ?? [])
        .slice(0, maxResults)
        .map((item) => {
          const entry: WebSearchResult = {
            title: item.title,
            url: item.url,
            snippet: item.description,
          };

          if (item.age !== undefined) entry.publishedDate = item.age;

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

      const response = await fetchWithTimeout(
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
      );

      const payload = await parseJsonResponse(response, "SearxNG", searxngResponseSchema);
      const results: WebSearchResult[] = payload.results.slice(0, maxResults).map((item) => {
        const entry: WebSearchResult = {
          title: item.title,
          url: item.url,
          snippet: item.content ?? "",
        };

        if (item.score !== undefined) entry.score = item.score;

        if (item.publishedDate) entry.publishedDate = item.publishedDate;

        return entry;
      });

      return { results };
    },
  };
}

async function fetchWithTimeout(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  abortSignal: AbortSignal | undefined,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`Search request timed out after ${timeoutMs}ms.`)),
    timeoutMs,
  );
  const signal =
    abortSignal === undefined
      ? controller.signal
      : AbortSignal.any([abortSignal, controller.signal]);

  try {
    return await fetchImpl(url, { ...init, signal });
  } finally {
    clearTimeout(timer);
  }
}

async function parseJsonResponse<T>(
  response: Response,
  providerName: string,
  schema: z.ZodType<T>,
): Promise<T> {
  const bodyText = await readBoundedBody(response, MAX_PROVIDER_RESPONSE_BYTES);

  if (!response.ok) {
    throw new Error(
      `${providerName} search failed (${response.status} ${response.statusText})${bodyText ? `: ${bodyText.slice(0, 300)}` : ""}`,
    );
  }

  const json: unknown = JSON.parse(bodyText);
  return schema.parse(json);
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<string> {
  if (response.body === null) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
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
