import { appendFileSync } from "node:fs";
import { DurableRuntime } from "../../src/index.js";
import { SqliteDurableStore } from "../../src/sqlite.js";
import { done, hasToolResult, lookup, makeAgent, toolResponse } from "../helpers.js";

const [database, effects, crashAt] = process.argv.slice(2);
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
    // The hook decision is already committed when the model call of the second turn starts.
    if (crashAt === "model") await halt();
    return done();
  },
  [
    lookup(async () => {
      appendFileSync(effects, "tool\n");
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
      hooks: {
        mode: "record",
        hook: {
          onToolCall: async ({ tool }) => {
            appendFileSync(effects, "hook\n");
            if (crashAt === "hook") await halt();
            return tool.skip("blocked by policy");
          },
        },
      },
    },
  ],
});
const run = await runtime.submit({
  agentId: agent.id,
  sessionId: "session",
  requestId: "hook",
  prompt: "hello",
});
id = run.id;
