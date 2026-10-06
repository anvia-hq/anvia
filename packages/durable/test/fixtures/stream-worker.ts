import { appendFileSync } from "node:fs";
import { Agent } from "@anvia/core/agent";
import type { CompletionModelStreamEvent, CompletionRequest } from "@anvia/core/completion";
import { DurableRuntime } from "../../src/index.js";
import { SqliteDurableStore } from "../../src/sqlite.js";
import { capabilities, done, hasToolResult, lookup, toolResponse } from "../helpers.js";

const [database, effects] = process.argv.slice(2);
if (database === undefined || effects === undefined) throw new Error("Missing fixture arguments");
let id: string;
const agent = new Agent({
  id: "researcher",
  model: {
    provider: "test",
    modelId: "test",
    capabilities: { ...capabilities, streaming: true },
    completion: async () => {
      throw new Error("Expected streaming execution");
    },
    async *streamCompletion(request: CompletionRequest): AsyncIterable<CompletionModelStreamEvent> {
      if (!hasToolResult(request)) {
        yield { type: "final", response: toolResponse() };
      } else {
        yield { type: "text_delta", delta: "partial" };
        // The durable boundary has persisted the delta before requesting the next event.
        process.send?.({ id });
        await new Promise<void>(() => {
          setInterval(() => {}, 1000);
        });
        yield { type: "final", response: done() };
      }
    },
  },
  tools: [
    lookup(async () => {
      appendFileSync(effects, "effect\n");
      return "saved result";
    }),
  ],
});
const runtime = await DurableRuntime.open({
  store: new SqliteDurableStore(database),
  agents: [{ agent, version: "1", stream: true }],
});
const run = await runtime.submit({
  agentId: agent.id,
  sessionId: "session",
  requestId: "stream",
  prompt: "hello",
});
id = run.id;
