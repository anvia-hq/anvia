import { appendFileSync } from "node:fs";
import { DurableRuntime } from "../../src/index.js";
import { SqliteDurableStore } from "../../src/sqlite.js";
import { done, hasToolResult, lookup, makeAgent, toolResponse } from "../helpers.js";

const [database, effects, crashAt, recovery = "manual"] = process.argv.slice(2);
if (database === undefined || effects === undefined) throw new Error("Missing fixture arguments");
let id: string;
const halt = async () => {
  process.send?.({ ready: true, id });
  await new Promise<void>(() => {
    setInterval(() => {}, 1000);
  });
};
const agent = makeAgent(
  async (request) => {
    if (!hasToolResult(request)) return toolResponse();
    if (crashAt === "model" || crashAt === "budget") await halt();
    return done();
  },
  [
    lookup(async (_args, context) => {
      appendFileSync(effects, recovery === "idempotent" ? `${context?.operationId}\n` : "effect\n");
      if (crashAt === "tool") await halt();
      return "stored result";
    }),
  ],
);
const runtime = await DurableRuntime.open({
  store: new SqliteDurableStore(database),
  agents: [
    {
      agent,
      version: "1",
      ...(crashAt === "budget"
        ? { modelRetry: { maxAttempts: 1, initialDelayMs: 1, maxDelayMs: 1 } }
        : {}),
      toolRecovery: { lookup: recovery as "safe" | "idempotent" | "manual" },
    },
  ],
});
const run = await runtime.submit({
  agentId: agent.id,
  sessionId: "session",
  requestId: "crash",
  prompt: "hello",
});
id = run.id;
