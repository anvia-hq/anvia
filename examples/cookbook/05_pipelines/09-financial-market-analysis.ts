import { Agent } from "@anvia/core/agent";
import { Pipeline } from "@anvia/core/pipeline";
import { createTool } from "@anvia/core/tool";
import { OpenAIClient } from "@anvia/openai";
import { z } from "zod";

const client = new OpenAIClient({
  baseUrl: process.env.OPENAI_BASEURL,
  apiKey: process.env.OPENAI_API_KEY,
});

const quoteSnapshotTool = createTool({
  name: "quote_snapshot",
  description: "Return a mock quote snapshot for a ticker.",
  inputSchema: z.object({
    ticker: z.string(),
  }),
  outputSchema: z.object({
    ticker: z.string(),
    price: z.number(),
    changePercent: z.number(),
    volume: z.number(),
  }),
  execute: ({ ticker }) => ({
    ticker: ticker.toUpperCase(),
    price: 184.32,
    changePercent: 1.4,
    volume: 42_100_000,
  }),
});
const marketNewsTool = createTool({
  name: "market_news",
  description: "Return mock market news for a ticker.",
  inputSchema: z.object({
    ticker: z.string(),
  }),
  outputSchema: z.array(z.string()),
  execute: ({ ticker }) => [
    `${ticker.toUpperCase()} raised full-year margin guidance.`,
    "Sector peers traded higher after stronger cloud infrastructure demand.",
    "Analysts remain focused on capex discipline and cash flow conversion.",
  ],
});
const riskFlagsTool = createTool({
  name: "risk_flags",
  description: "Return mock risk flags for a ticker.",
  inputSchema: z.object({
    ticker: z.string(),
  }),
  outputSchema: z.array(z.string()),
  execute: () => [
    "Mock data; do not treat this as investment advice.",
    "Single-day price movement can be noise.",
    "News set is incomplete and should be verified.",
  ],
});

const quoteSnapshot = new Pipeline({ id: "quote-snapshot", inputSchema: z.string() }).step({
  id: "quote",
  run: ({ input: ticker }) => quoteSnapshotTool.call({ ticker }),
});

const marketNews = new Pipeline({ id: "market-news", inputSchema: z.string() }).step({
  id: "news",
  run: ({ input: ticker }) => marketNewsTool.call({ ticker }),
});

const riskFlags = new Pipeline({ id: "risk-flags", inputSchema: z.string() }).step({
  id: "risks",
  run: ({ input: ticker }) => riskFlagsTool.call({ ticker }),
});

const marketAnalystModel = client.completionModel("gpt-5.5");
const marketAnalyst = new Agent({
  id: "market-analyst",
  model: marketAnalystModel,
  instructions: [
    "You write cautious market analysis from provided data only.",
    "Do not provide personalized investment advice.",
    "Separate summary, drivers, risks, and follow-up checks.",
    "Return visible final text, not only reasoning.",
  ].join("\n"),
});

const marketPipeline = new Pipeline({ id: "market-analysis", inputSchema: z.string() })
  .step({ id: "normalize-ticker", run: ({ input }) => input.trim().toUpperCase() })
  .parallel({
    id: "market-signals",
    branches: {
      quoteJson: quoteSnapshot,
      newsJson: marketNews,
      risksJson: riskFlags,
    },
  })
  .agent({
    id: "analyze",
    agent: marketAnalyst,
    approval: "reject",
    request: ({ input: { quoteJson: quote, newsJson: news, risksJson: risks } }) => ({
      prompt: [
        `Analyze this mock market packet for ${quote.ticker}.`,
        "",
        `Price: ${quote.price}`,
        `Change: ${quote.changePercent}%`,
        `Volume: ${quote.volume}`,
        "",
        "News:",
        ...news.map((item) => `- ${item}`),
        "",
        "Risks:",
        ...risks.map((item) => `- ${item}`),
      ].join("\n"),
    }),
  });

const { output: analysis } = await marketPipeline.run({ input: "ACME" });

console.log(analysis);
