import { AgentBuilder } from "@anvia/core/agent";
import { PipelineBuilder } from "@anvia/core/pipeline";
import {
  createTool,
  type NormalizedToolOutput,
  ToolSet,
  toolResultContentToText,
} from "@anvia/core/tool";
import { OpenAIClient } from "@anvia/openai";
import { z } from "zod";

const client = new OpenAIClient({
  baseUrl: process.env.OPENAI_BASEURL,
  apiKey: process.env.OPENAI_API_KEY,
});

const marketTools = ToolSet.fromTools([
  createTool({
    name: "quote_snapshot",
    description: "Return a mock quote snapshot for a ticker.",
    input: z.object({
      ticker: z.string(),
    }),
    output: z.object({
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
  }),
  createTool({
    name: "market_news",
    description: "Return mock market news for a ticker.",
    input: z.object({
      ticker: z.string(),
    }),
    output: z.array(z.string()),
    execute: ({ ticker }) => [
      `${ticker.toUpperCase()} raised full-year margin guidance.`,
      "Sector peers traded higher after stronger cloud infrastructure demand.",
      "Analysts remain focused on capex discipline and cash flow conversion.",
    ],
  }),
  createTool({
    name: "risk_flags",
    description: "Return mock risk flags for a ticker.",
    input: z.object({
      ticker: z.string(),
    }),
    output: z.array(z.string()),
    execute: () => [
      "Mock data; do not treat this as investment advice.",
      "Single-day price movement can be noise.",
      "News set is incomplete and should be verified.",
    ],
  }),
]);

const quoteSnapshot = new PipelineBuilder(z.string())
  .step((ticker) => marketTools.call("quote_snapshot", JSON.stringify({ ticker })))
  .build();

const marketNews = new PipelineBuilder(z.string())
  .step((ticker) => marketTools.call("market_news", JSON.stringify({ ticker })))
  .build();

const riskFlags = new PipelineBuilder(z.string())
  .step((ticker) => marketTools.call("risk_flags", JSON.stringify({ ticker })))
  .build();

const marketAnalystModel = client.completionModel("gpt-5.5");
const marketAnalyst = new AgentBuilder("market-analyst", marketAnalystModel)
  .instructions(
    [
      "You write cautious market analysis from provided data only.",
      "Do not provide personalized investment advice.",
      "Separate summary, drivers, risks, and follow-up checks.",
      "Return visible final text, not only reasoning.",
    ].join("\n"),
  )
  .build();

const marketPipeline = new PipelineBuilder(z.string())
  .step((ticker) => ticker.trim().toUpperCase())
  .parallel({
    quoteJson: quoteSnapshot,
    newsJson: marketNews,
    risksJson: riskFlags,
  })
  .step(({ quoteJson, newsJson, risksJson }) => {
    const quote = JSON.parse(toolOutputText(quoteJson)) as {
      ticker: string;
      price: number;
      changePercent: number;
      volume: number;
    };
    const news = JSON.parse(toolOutputText(newsJson)) as string[];
    const risks = JSON.parse(toolOutputText(risksJson)) as string[];

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
  .prompt(marketAnalyst)
  .build();

const analysis = await marketPipeline.run("ACME");

console.log(analysis);

function toolOutputText(output: NormalizedToolOutput): string {
  return typeof output === "string" ? output : toolResultContentToText(output);
}
