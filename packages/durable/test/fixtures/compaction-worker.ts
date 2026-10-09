import { appendFileSync } from "node:fs";
import { Usage } from "@anvia/core/completion";
import { DurableRuntime } from "../../src/index.js";
import { SqliteDurableStore } from "../../src/sqlite.js";
import { done, makeAgent } from "../helpers.js";
const [database, calls, stage] = process.argv.slice(2);
if (database === undefined || calls === undefined) throw new Error("Missing fixture arguments");
let id: string;
async function halt(): Promise<never> {
  process.send?.({ id });
  return new Promise(() => {
    setInterval(() => {}, 1000);
  });
}
let modelCalls = 0;
const runtime = await DurableRuntime.open({
  store: new SqliteDurableStore(database),
  agents: [
    {
      agent: makeAgent(async () => {
        if (++modelCalls === 2 && stage === "model") await halt();
        return done();
      }),
      version: "1",
      compaction: {
        trigger: { afterTokens: 1 },
        retention: { recentTurns: 0 },
        compactor: async () => {
          appendFileSync(calls, "summary\n");
          if (stage === "summary") await halt();
          return {
            summary: "Earlier decisions.",
            usage: { ...Usage.empty(), inputTokens: 5, outputTokens: 2, totalTokens: 7 },
          };
        },
      },
    },
  ],
});
const input = { agentId: "researcher", sessionId: "session", requestId: "1", prompt: "Question 1" };
await (await runtime.submit(input)).result();
id = (await runtime.submit({ ...input, requestId: "2", prompt: "Question 2" })).id;
