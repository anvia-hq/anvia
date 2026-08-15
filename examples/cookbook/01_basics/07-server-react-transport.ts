import { agentToClientStream, createHttpClientTransport } from "@anvia/client";
import type { AgentStreamEvent } from "@anvia/core/agent";
import { Message } from "@anvia/core/completion";
import { createClientStreamResponse } from "@anvia/server";

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
    result: {
      status: "completed",
      runId: "run_123",
      output: "Hello from Anvia",
      text: "Hello from Anvia",
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        cachedInputTokens: 0,
        cacheCreationInputTokens: 0,
      },
      messages: [],
    },
  };
}

const response = createClientStreamResponse(
  agentToClientStream(runEvents(), { runId: "run_123" }),
  { format: "jsonl", streamId: "stream_123" },
);
const transport = createHttpClientTransport({
  endpoint: "/api/chat",
  fetch: async () => response,
});

let output = "";
for await (const frame of transport.send({ messages: [Message.user("Hello")] })) {
  if (frame.type !== "stream_event") continue;
  const event = frame.event;
  if (event.type === "text_delta") {
    output += event.delta;
  }
  if (event.type === "run_end") {
    console.log(event.text);
  }
}

console.log(`Accumulated: ${output}`);
