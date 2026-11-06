import { appendFileSync } from "node:fs";
import { Agent } from "@anvia/core/agent";
import { DurableRuntime } from "../../src/index.js";
import { SqliteDurableStore } from "../../src/sqlite.js";
import { capabilities, done } from "../helpers.js";
import { FileMemoryStore } from "./file-memory-store.js";

const [database, memoryPath, modelCalls, crashAt] = process.argv.slice(2);
if (database === undefined || memoryPath === undefined || modelCalls === undefined)
  throw new Error("Missing fixture arguments");
let id: string | undefined;
const halt = async () => {
  process.send?.({ id });
  await new Promise<void>(() => {
    setInterval(() => {}, 1000);
  });
};
const store = new FileMemoryStore(
  memoryPath,
  async () => {
    if (crashAt === "before-commit") await halt();
  },
  async () => {
    if (crashAt === "after-commit") await halt();
  },
);
const agent = new Agent({
  id: "remembering",
  memory: { store, savePolicy: "run" },
  model: {
    provider: "test",
    modelId: "test",
    capabilities,
    completion: async () => {
      appendFileSync(modelCalls, "call\n");
      return done();
    },
  },
} as ConstructorParameters<typeof Agent>[0]);
const runtime = await DurableRuntime.open({
  store: new SqliteDurableStore(database),
  agents: [{ agent, version: "1", memory: { mode: "recorded" } }],
});
id = (
  await runtime.submit({
    agentId: "remembering",
    sessionId: "session",
    requestId: "one",
    prompt: "hello",
  })
).id;
await new Promise<void>(() => {
  setInterval(() => {}, 1000);
});
