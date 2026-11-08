import { appendFileSync } from "node:fs";
import type { AnyTool } from "@anvia/core/tool";
import { DurableRuntime } from "../../src/index.js";
import { SqliteDurableStore } from "../../src/sqlite.js";
import { done, hasToolResult, makeAgent, response } from "../helpers.js";

/** One turn with two tool calls: `fast` commits, `stuck` is killed mid-flight. */
export const twoCalls = () =>
  response([
    { type: "tool-call", toolCallId: "call-fast", toolName: "fast", input: {} },
    { type: "tool-call", toolCallId: "call-stuck", toolName: "stuck", input: {} },
  ]);

export function tools(effects: string, onStuck: () => Promise<void> | void): AnyTool[] {
  const make = (name: string, call: AnyTool["call"]): AnyTool => ({
    name,
    definition: () => ({
      name,
      description: name,
      parameters: { type: "object", properties: {} },
    }),
    call,
  });
  return [
    make("fast", async () => {
      appendFileSync(effects, "fast\n");
      return "fast result";
    }),
    make("stuck", async () => {
      appendFileSync(effects, "stuck\n");
      await onStuck();
      return "stuck result";
    }),
  ];
}

export const recovery = { fast: "safe", stuck: "safe" } as const;

if (process.argv[1]?.endsWith("parallel-crash-worker.ts")) {
  const [database, effects] = process.argv.slice(2);
  if (database === undefined || effects === undefined) throw new Error("Missing arguments");
  let id = "";
  const agent = makeAgent(
    async (request) => (hasToolResult(request) ? done() : twoCalls()),
    tools(effects, async () => {
      // Let the fast call commit before reporting ready, then hang until killed.
      await new Promise((resolve) => setTimeout(resolve, 200));
      process.send?.({ ready: true, id });
      await new Promise<void>(() => setInterval(() => {}, 1000));
    }),
  );
  const runtime = await DurableRuntime.open({
    store: new SqliteDurableStore(database),
    agents: [{ agent, version: "1", toolConcurrency: 2, toolRecovery: recovery }],
  });
  id = (
    await runtime.submit({
      agentId: agent.id,
      sessionId: "session",
      requestId: "parallel",
      prompt: "hello",
    })
  ).id;
}
