import type { CompletionModel } from "@anvia/core";
import { Agent, type AgentOptions, type AgentResponse, type AgentResult } from "@anvia/core/agent";
import { type AnyTool, createTool } from "@anvia/core/tool";
import type { LangfuseClient, LangfuseObserverOptions } from "@anvia/langfuse";
import { z } from "zod";

// Same tool as cookbook 10_integrations/03-langfuse-tracing.ts so the
// tool-observation demo mirrors an existing real-world example.
export const getTicket = createTool({
  name: "get_ticket",
  description: "Read a support ticket from local application state.",
  inputSchema: z.object({
    id: z.string().describe("The ticket id to read."),
  }),
  outputSchema: z.object({
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
  tracing?: LangfuseClient;
  observerOptions?: LangfuseObserverOptions;
  tools?: AnyTool[];
  instructions?: string;
};

export function assertCompleted(result: AgentResult): asserts result is AgentResponse {
  if (result.status !== "completed") {
    throw new Error(`Expected a completed Agent result, received ${result.status}.`);
  }
}

export function buildSupportAgent(model: CompletionModel, options: BuildSupportAgentOptions = {}) {
  const tools = options.tools ?? [];
  const agentOptions: AgentOptions = {
    id: "support-agent",
    model,
    instructions:
      options.instructions ??
      "Use tools when useful. Answer with a short engineering-focused summary.",
    tools,
    maxTurns: 2,
  };
  if (options.tracing !== undefined) {
    agentOptions.observability = {
      observers: {
        langfuse: options.tracing.observer(options.observerOptions),
      },
      primaryTrace: "langfuse",
    };
  }
  return new Agent(agentOptions);
}
