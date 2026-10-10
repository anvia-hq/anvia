import { appendFileSync } from "node:fs";
import { DurableRuntime } from "../../src/index.js";
import { SqliteDurableStore } from "../../src/sqlite.js";
import { done, hasToolResult, lookup, makeAgent, toolResponse } from "../helpers.js";

const [database, effects] = process.argv.slice(2);
if (database === undefined || effects === undefined) throw new Error("Missing fixture arguments");
let id: string;
const agent = makeAgent(
  async (request) => {
    if (!hasToolResult(request)) return toolResponse();
    runtime.steer(id, { prompt: "queued before crash" }, { requestId: "pending" });
    process.send?.({ id, request });
    await new Promise<void>(() => {
      setInterval(() => {}, 1000);
    });
    return done();
  },
  [
    lookup(async () => {
      appendFileSync(effects, "effect\n");
      runtime.steer(id, { prompt: "applied before crash" }, { requestId: "applied" });
      return "stored result";
    }),
  ],
);
const runtime = await DurableRuntime.open({
  store: new SqliteDurableStore(database),
  agents: [{ agent, version: "1" }],
});
id = (
  await runtime.submit({
    agentId: agent.id,
    sessionId: "session",
    requestId: "crash",
    prompt: "hello",
  })
).id;
