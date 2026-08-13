import { Agent } from "@anvia/core/agent";
import { PipelineBuilder } from "@anvia/core/pipeline";
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

const quoteSnapshot = new PipelineBuilder(z.string())
  .step((ticker) => quoteSnapshotTool.call({ ticker }))
  .build();

const marketNews = new PipelineBuilder(z.string())
  .step((ticker) => marketNewsTool.call({ ticker }))
  .build();

const riskFlags = new PipelineBuilder(z.string())
  .step((ticker) => riskFlagsTool.call({ ticker }))
  .build();

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

const marketPipeline = new PipelineBuilder(z.string())
  .step((ticker) => ticker.trim().toUpperCase())
  .parallel({
    quoteJson: quoteSnapshot,
    newsJson: marketNews,
    risksJson: riskFlags,
  })
  .step(({ quoteJson: quote, newsJson: news, risksJson: risks }) => {
    return [
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
    ].join("\n");
  })
  .agent(marketAnalyst)
  .build();

const analysis = await marketPipeline.run("ACME");

console.log(analysis);
