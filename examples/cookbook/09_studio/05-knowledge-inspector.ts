import { AgentBuilder } from "@anvia/core/agent";
import type { Embedding, EmbeddingModel } from "@anvia/core/embeddings";
import { embedDocuments } from "@anvia/core/embeddings";
import { createTool, createToolIndex } from "@anvia/core/tool";
import { InMemoryVectorStore } from "@anvia/core/vector-store";
import { OpenAIClient } from "@anvia/openai";
import { Studio } from "@anvia/studio";
import { z } from "zod";

type KnowledgeNote = {
  id: string;
  text: string;
  area: "support" | "engineering" | "communications";
};

class KeywordEmbeddingModel implements EmbeddingModel {
  async embedTexts(texts: string[]): Promise<Embedding[]> {
    return texts.map((text) => ({ document: text, vector: vectorFor(text) }));
  }
}

const client = new OpenAIClient({
  baseUrl: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});

const notes: KnowledgeNote[] = [
  {
    id: "enterprise-escalation",
    area: "support",
    text: "Enterprise incidents with blocked orders require a support lead summary and engineering owner before customer commitments.",
  },
  {
    id: "webhook-retry-runbook",
    area: "engineering",
    text: "Webhook retry diagnostics should include retry queue depth, payload-size rejection logs, and recent deployment changes.",
  },
  {
    id: "customer-update-policy",
    area: "communications",
    text: "Customer updates should acknowledge impact, avoid unverified root-cause claims, and give the next checkpoint time.",
  },
];

const getTicket = createTool({
  name: "get_ticket",
  description: "Read a support ticket from local application state.",
  input: z.object({
    id: z.string().describe("The support ticket id."),
  }),
  output: z.object({
    id: z.string(),
    customer: z.string(),
    status: z.string(),
    priority: z.enum(["low", "medium", "high"]),
    summary: z.string(),
  }),
  execute: ({ id }) => ({
    id,
    customer: "Delta Kit Labs",
    status: "blocked",
    priority: "high" as const,
    summary: "Order allocation is blocked while webhook retry diagnostics are reviewed.",
  }),
});

const lookupCustomer = createTool({
  name: "lookup_customer",
  description: "Read customer account context and communication preferences.",
  input: z.object({
    name: z.string().describe("The customer name."),
  }),
  output: z.object({
    name: z.string(),
    tier: z.string(),
    preferredChannel: z.string(),
  }),
  execute: ({ name }) => ({
    name,
    tier: "enterprise",
    preferredChannel: "shared incident channel",
  }),
});

const embeddings = new KeywordEmbeddingModel();
const embeddedNotes = await embedDocuments(embeddings, notes, {
  id: (note) => note.id,
  content: (note) => note.text,
  metadata: (note) => ({ area: note.area }),
});
const knowledgeIndex = InMemoryVectorStore.fromDocuments(embeddedNotes).index(embeddings);
const toolIndex = await createToolIndex(embeddings, [getTicket, lookupCustomer]);

const model = client.completionModel("deepseek/deepseek-v4-pro");
const agent = new AgentBuilder("studio-knowledge-ops", model)
  .name("Studio Knowledge Ops")
  .description("Demonstrates the Studio Knowledge inspector.")
  .instructions(
    [
      "Use retrieved knowledge and tools when relevant.",
      "Cite the operational policy or runbook facts you used in plain language.",
      "Keep the response concise and action-oriented.",
    ].join("\n"),
  )
  .context(
    "Studio Knowledge is an inspector surface. It shows static context, dynamic context, dynamic tools, and trace evidence; it does not edit documents.",
    "studio-knowledge-scope",
  )
  .dynamicContext(knowledgeIndex, {
    topK: 2,
    threshold: 0.55,
    format: (result) => ({
      id: result.id,
      text: result.document.text,
      additionalProps: {
        area: result.document.area,
        score: result.score.toFixed(3),
      },
    }),
  })
  .dynamicTools(toolIndex, {
    topK: 1,
    threshold: 0.75,
  })
  .defaultMaxTurns(4)
  .build();

new Studio([agent], {
  quickPrompts: {
    "studio-knowledge-ops": [
      "Summarize TICKET-1001 and include the enterprise escalation policy.",
      "What should engineering check for webhook retry diagnostics?",
      "Draft a short customer update for Delta Kit Labs.",
    ],
  },
}).start();

function vectorFor(text: string): number[] {
  const normalized = text.toLowerCase();
  return [
    score(normalized, ["ticket", "order", "blocked", "support", "enterprise", "escalation"]),
    score(normalized, ["webhook", "retry", "diagnostic", "queue", "payload", "engineering"]),
    score(normalized, ["customer", "update", "communication", "incident", "channel"]),
  ];
}

function score(text: string, keywords: string[]): number {
  return keywords.reduce((total, keyword) => total + (text.includes(keyword) ? 1 : 0), 0);
}
