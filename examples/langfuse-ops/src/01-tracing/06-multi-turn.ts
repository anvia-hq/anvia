// Demonstrates: a multi-turn agent session, where memory carries context
// across traced generations.

import { AgentBuilder } from "@anvia/core/agent";
import type { Message } from "@anvia/core/completion";
import type { MemoryAppendInput, MemoryContext, MemoryStore } from "@anvia/core/memory";
import { getTicket } from "../_support/agent.js";
import { buildOpenAIClient, defaultModel } from "../_support/model.js";
import { createTracing } from "../_support/tracing.js";

class LocalMemoryStore implements MemoryStore {
  private readonly sessions = new Map<string, Message[]>();

  async load(context: MemoryContext): Promise<Message[]> {
    return [...(this.sessions.get(context.sessionId) ?? [])];
  }

  async append(input: MemoryAppendInput): Promise<void> {
    const current = this.sessions.get(input.context.sessionId) ?? [];
    this.sessions.set(input.context.sessionId, [...current, ...input.messages]);
  }

  async clear(context: MemoryContext): Promise<void> {
    this.sessions.delete(context.sessionId);
  }
}

async function main(): Promise<void> {
  const tracing = createTracing({ name: "langfuse-ops-tracing-06" });
  try {
    const client = buildOpenAIClient();
    const agent = new AgentBuilder("support-agent", client.completionModel(defaultModel()))
      .instructions("Use tools when useful. Answer with a short engineering-focused summary.")
      .observe(tracing)
      .tools([getTicket])
      .memory(new LocalMemoryStore())
      .defaultMaxTurns(2)
      .build();
    const session = agent.session("langfuse-ops-multi-turn", { userId: "langfuse-ops-user" });

    const first = await session
      .prompt("What ticket is TICKET-1001 about? Give a one-line summary.")
      .withTrace({ name: "multi-turn-demo", tags: ["tracing:06", "turn-1"] })
      .send();
    console.log("[tracing:06] turn 1:", first.output);

    const second = await session
      .prompt("Now rewrite the summary in two sentences.")
      .withTrace({ name: "multi-turn-demo", tags: ["tracing:06", "turn-2"] })
      .send();
    console.log("[tracing:06] turn 2:", second.output);
  } finally {
    await tracing.shutdown();
  }
}

main().catch((error: unknown) => {
  console.error("[tracing:06] failed:", error);
  process.exit(1);
});
