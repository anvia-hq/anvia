import { createTool, createToolkit, type Toolkit } from "@anvia/core/tool";
import { z } from "zod";
import type { WebSearchOptions, WebSearchToolName } from "./types";

export {
  brave,
  exa,
  firecrawl,
  jina,
  perplexity,
  searxng,
  serper,
  tavily,
  type BraveProviderOptions,
  type ExaProviderOptions,
  type FirecrawlProviderOptions,
  type JinaProviderOptions,
  type PerplexityProviderOptions,
  type SearxngProviderOptions,
  type SerperProviderOptions,
  type TavilyProviderOptions,
} from "./providers";
export type {
  WebSearchOptions,
  WebSearchProvider,
  WebSearchProviderResponse,
  WebSearchRequest,
  WebSearchResult,
  WebSearchToolName,
} from "./types";

const DEFAULT_INSTRUCTIONS =
  "Use web_search to find up-to-date information and authoritative sources. Cite the returned URLs when summarizing findings.";

export function webSearch(options: WebSearchOptions): Toolkit {
  const defaultMaxResults = options.maxResults ?? 5;
  const maxResultsLimit = options.maxResultsLimit ?? Math.max(10, defaultMaxResults);

  if (!Number.isSafeInteger(defaultMaxResults) || defaultMaxResults <= 0) {
    throw new RangeError("webSearch maxResults must be a positive safe integer.");
  }

  if (!Number.isSafeInteger(maxResultsLimit) || maxResultsLimit < defaultMaxResults) {
    throw new RangeError("webSearch maxResultsLimit must be >= maxResults.");
  }

  const searchTool = createTool({
    name: "web_search",
    description: `Search the web using ${options.provider.name} and return titles, URLs, and snippets.`,
    inputSchema: z.object({
      query: z.string().min(1).describe("The search query."),
      maxResults: z
        .number()
        .int()
        .min(1)
        .max(maxResultsLimit)
        .optional()
        .describe(
          `Number of results to return (default ${defaultMaxResults}, max ${maxResultsLimit}).`,
        ),
    }),
    handler: async (args, context) => {
      const requestedMax = Math.min(args.maxResults ?? defaultMaxResults, maxResultsLimit);
      const response = await options.provider.search({
        query: args.query,
        maxResults: requestedMax,
        abortSignal: context.abortSignal,
      });

      const results = response.results.slice(0, requestedMax).map((item) => {
        const entry: Record<string, unknown> = {
          title: item.title,
          url: item.url,
          snippet: item.snippet,
        };

        if (item.score !== undefined) entry.score = item.score;

        if (item.publishedDate !== undefined) entry.publishedDate = item.publishedDate;

        return entry;
      });

      const payload: Record<string, unknown> = {
        provider: options.provider.name,
        query: args.query,
        results,
      };

      if (response.answer !== undefined) payload.answer = response.answer;

      return payload;
    },
  });

  return createToolkit<WebSearchToolName>(
    {
      name: "web-search",
      tools: [searchTool],
      instructions: DEFAULT_INSTRUCTIONS,
    },
    options,
  );
}
