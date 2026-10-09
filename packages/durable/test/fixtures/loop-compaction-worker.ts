import { appendFileSync } from "node:fs";
import { Usage } from "@anvia/core/completion";
import { DurableRuntime } from "../../src/index.js";
import { SqliteDurableStore } from "../../src/sqlite.js";
import { done, lookup, makeAgent, toolResponse } from "../helpers.js";
const [path, calls, stage] = process.argv.slice(2);
if (path === undefined || calls === undefined) throw new Error("Missing fixture arguments");
let id: string;
async function halt(): Promise<never> {
  process.send?.({ id });
  return new Promise(() => {
    setInterval(() => {}, 1000);
  });
}
let modelCalls = 0;
const runtime = await DurableRuntime.open({
  store: new SqliteDurableStore(path),
  agents: [
    {
      agent: makeAgent(async () => {
        if (++modelCalls === 1) return toolResponse();
        if (stage === "model") await halt();
        return done();
      }, [
        lookup(async () => {
          appendFileSync(calls, "tool\n");
          return "payload".repeat(1000);
        }),
      ]),
      version: "1",
      toolRecovery: { lookup: "safe" },
      compaction: {
        trigger: { afterTokens: 500 },
        retention: { recentToolTurns: 0 },
        compactor: async () => {
          appendFileSync(calls, "summary\n");
          if (stage === "summary") await halt();
          return {
            summary: "Lookup found the answer.",
            usage: { ...Usage.empty(), inputTokens: 5, outputTokens: 2, totalTokens: 7 },
          };
        },
      },
    },
  ],
});
id = (
  await runtime.submit({
    agentId: "researcher",
    sessionId: "session",
    requestId: "1",
    prompt: "Find the answer",
  })
).id;
