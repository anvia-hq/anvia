import type { ToolkitOptions } from "@anvia/core/tool";

export type WebSearchResult = {
  title: string;
  url: string;
  snippet: string;
  score?: number | undefined;
  publishedDate?: string | undefined;
};

export type WebSearchRequest = {
  query: string;
  maxResults: number;
  abortSignal?: AbortSignal | undefined;
};

export type WebSearchProviderResponse = {
  results: readonly WebSearchResult[];
  answer?: string | undefined;
};

export interface WebSearchProvider {
  readonly name: string;
  search(request: WebSearchRequest): Promise<WebSearchProviderResponse>;
}

export type WebSearchToolName = "web_search";

export type WebSearchOptions = ToolkitOptions<WebSearchToolName> & {
  provider: WebSearchProvider;
  /** Default maximum results per search (1..20). Default 5. */
  maxResults?: number | undefined;
  /** Hard upper cap allowed for model-supplied maxResults. Default 10. */
  maxResultsLimit?: number | undefined;
};
