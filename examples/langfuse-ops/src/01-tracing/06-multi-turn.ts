// Demonstrates: a multi-turn agent session, where memory carries context
// across traced generations.

import { Agent } from "@anvia/core/agent";
import type { Message } from "@anvia/core/completion";
import type { MemoryAppendOptions, MemoryScope, MemoryStore } from "@anvia/core/memory";
import { assertCompleted, getTicket } from "../_support/agent.js";
import { buildOpenAIClient, defaultModel } from "../_support/model.js";
import { createTracing } from "../_support/tracing.js";

class LocalMemoryStore implements MemoryStore {
  private readonly sessions = new Map<string, Message[]>();

  async load({ scope }: { scope: MemoryScope }): Promise<Message[]> {
    return [...(this.sessions.get(scope.sessionId) ?? [])];
  }

  async append(input: MemoryAppendOptions): Promise<void> {
    const current = this.sessions.get(input.scope.sessionId) ?? [];
    this.sessions.set(input.scope.sessionId, [...current, ...input.messages]);
  }

  async clear({ scope }: { scope: MemoryScope }): Promise<void> {
    this.sessions.delete(scope.sessionId);
  }
}

async function main(): Promise<void> {
  await using tracing = createTracing({ name: "langfuse-ops-tracing-06" });
  const client = buildOpenAIClient();
  const agent = new Agent({
    id: "support-agent",
    model: client.completionModel(defaultModel()),
    instructions: "Use tools when useful. Answer with a short engineering-focused summary.",
    memory: { store: new LocalMemoryStore() },
    maxTurns: 2,
    tools: [getTicket],
    observability: {
      observers: { langfuse: tracing.observer() },
      primaryTrace: "langfuse",
    },
  });
  const session = {
    sessionId: "langfuse-ops-multi-turn",
    userId: "langfuse-ops-user",
  };

  const first = await agent.generate({
    prompt: "What ticket is TICKET-1001 about? Give a one-line summary.",
    session,
    trace: { name: "multi-turn-demo", tags: ["tracing:06", "turn-1"] },
  });
  assertCompleted(first);
  console.log("[tracing:06] turn 1:", first.output);

  const second = await agent.generate({
    prompt: "Now rewrite the summary in two sentences.",
    session,
    trace: { name: "multi-turn-demo", tags: ["tracing:06", "turn-2"] },
  });
  assertCompleted(second);
  console.log("[tracing:06] turn 2:", second.output);
}

main().catch((error: unknown) => {
  console.error("[tracing:06] failed:", error);
  process.exit(1);
});
