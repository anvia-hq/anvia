import type { AgentStreamEvent } from "@anvia/core/agent";
import { fetchEventStream } from "@anvia/react";
import { createEventStream } from "@anvia/server";

async function* runEvents(): AsyncIterable<AgentStreamEvent> {
  yield {
    type: "turn_start",
    turn: 1,
    prompt: { role: "user", content: [{ type: "text", text: "Hello" }] },
    history: [],
  };
  yield { type: "text_delta", turn: 1, delta: "Hello" };
  yield { type: "text_delta", turn: 1, delta: " from Anvia" };
  yield {
    type: "final",
    runId: "run_123",
    output: "Hello from Anvia",
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cachedInputTokens: 0,
      cacheCreationInputTokens: 0,
    },
    messages: [],
  };
}

const response = createEventStream(runEvents(), { format: "jsonl" });

let output = "";
for await (const event of fetchEventStream<AgentStreamEvent>("/api/chat", {
  fetch: async () => response,
})) {
  if (event.type === "text_delta") {
    output += event.delta;
  }
  if (event.type === "final") {
    console.log(event.output);
  }
}

console.log(`Accumulated: ${output}`);
