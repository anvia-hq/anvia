import { DurableRuntime } from "../../src/index.js";
import { SqliteDurableStore } from "../../src/sqlite.js";
import { done, makeAgent } from "../helpers.js";

const database = process.argv[2]!;
let graphId: string;
const runtime = await DurableRuntime.open({
  store: new SqliteDurableStore(database),
  agents: [
    {
      agent: makeAgent(async (request) => {
        if (JSON.stringify(request.chatHistory).includes("CHILD")) {
          process.send?.({ id: graphId });
          await new Promise<void>(() => {
            setInterval(() => {}, 1000);
          });
        }
        return done();
      }),
      version: "1",
    },
  ],
});
const graph = await runtime.submitGraph({
  sessionId: "graph-session",
  requestId: "graph-request",
  tasks: [
    { id: "root", agentId: "researcher", prompt: "ROOT" },
    { id: "child", agentId: "researcher", prompt: "CHILD", dependsOn: ["root"] },
  ],
});
graphId = graph.id;
