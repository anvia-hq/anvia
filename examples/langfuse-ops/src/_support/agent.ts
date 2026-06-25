import type { CompletionModel } from "@anvia/core";
import { AgentBuilder } from "@anvia/core/agent";
import { type AnyTool, createTool } from "@anvia/core/tool";
import type { LangfuseTracing } from "@anvia/langfuse";
import { z } from "zod";

// Same tool as cookbook 10_integrations/03-langfuse-tracing.ts so the
// tool-observation demo mirrors an existing real-world example.
export const getTicket = createTool({
  name: "get_ticket",
  description: "Read a support ticket from local application state.",
  input: z.object({
    id: z.string().describe("The ticket id to read."),
  }),
  output: z.object({
    id: z.string(),
    title: z.string(),
    severity: z.enum(["low", "medium", "high"]),
    summary: z.string(),
  }),
  execute: ({ id }) => ({
    id,
    title: "Checkout button disabled after address autocomplete",
    severity: "high" as const,
    summary:
      "Users can select an address, but checkout remains disabled until they reload the page.",
  }),
});

export type BuildSupportAgentOptions = {
  tracing?: LangfuseTracing;
  tools?: AnyTool[];
  instructions?: string;
};

export function buildSupportAgent(model: CompletionModel, options: BuildSupportAgentOptions = {}) {
  const tools = options.tools ?? [];
  const agent = new AgentBuilder("support-agent", model)
    .instructions(
      options.instructions ??
        "Use tools when useful. Answer with a short engineering-focused summary.",
    )
    .tools(tools)
    .defaultMaxTurns(2);
  if (options.tracing !== undefined) {
    agent.observe(options.tracing);
  }
  return agent.build();
}
