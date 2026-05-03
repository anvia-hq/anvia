import { createTool } from "@anvia/core/tool";
import { z } from "zod";

type TavilySearchResponse = {
  answer?: string;
  results?: TavilySearchResult[];
};

type TavilySearchResult = {
  title?: string;
  url?: string;
  content?: string;
  score?: number;
};

type TavilySearchArgs = {
  query: string;
};

const searchInputSchema = z.object({
  query: z.string().min(1).describe("The web search query."),
}) as z.ZodType<TavilySearchArgs>;

const searchOutputSchema = z.string() as z.ZodType<string>;

export function createTavilySearchTool(apiKey: string) {
  return createTool({
    name: "web_search",
    description:
      "Search the public internet for current or external information. Use this when the user asks about recent events, facts that may have changed, or anything that needs web lookup.",
    input: searchInputSchema,
    output: searchOutputSchema,
    execute: async ({ query }) => {
      const response = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          query,
          search_depth: "basic",
          include_answer: true,
          include_raw_content: false,
          max_results: 5,
        }),
      });

      if (!response.ok) {
        throw new Error(`Tavily search failed: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as TavilySearchResponse;
      return formatTavilySearchResults(data);
    },
  });
}

function formatTavilySearchResults(data: TavilySearchResponse) {
  const parts: string[] = [];

  if (data.answer !== undefined && data.answer.length > 0) {
    parts.push(`Answer:\n${data.answer}`);
  }

  const results = data.results ?? [];
  if (results.length > 0) {
    parts.push(
      [
        "Sources:",
        ...results.map((result, index) => {
          const title = result.title ?? "Untitled";
          const url = result.url ?? "No URL";
          const content = result.content ?? "";
          const score = result.score === undefined ? "" : ` (score: ${result.score})`;
          return `${index + 1}. ${title}${score}\n${url}\n${content}`;
        }),
      ].join("\n\n"),
    );
  }

  return parts.length > 0 ? parts.join("\n\n") : "No search results found.";
}
