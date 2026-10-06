import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import { DurableRuntime, defineTask, type ToolRecovery } from "../../src/index.js";
import { SqliteDurableStore } from "../../src/sqlite.js";

const [database, effects, mode] = process.argv.slice(2) as [string, string, string];
const child = defineTask({
  name: "child",
  version: 1,
  input: z.null(),
  checkpoint: z.null(),
  output: z.null(),
  initial: () => null,
  run: async () => {
    appendFileSync(effects, "child\n");
    return { status: "completed", output: null };
  },
});
const parent = defineTask({
  name: "parent",
  version: 1,
  input: z.null(),
  checkpoint: z.null(),
  output: z.string(),
  initial: () => null,
  run: async (ctx) => {
    ctx.spawn("child", child, null);
    const output = await ctx.effect(
      "external",
      { amount: 1 },
      async (operationId) => {
        if (!existsSync(effects) || !readFileSync(effects, "utf8").includes(operationId))
          appendFileSync(effects, `${operationId}\n`);
        if (mode !== "committed") {
          process.send?.({ id: ctx.id });
          await new Promise<void>(() => {
            setInterval(() => {}, 1000);
          });
        }
        return "receipt";
      },
      (mode === "idempotent" ? "idempotent" : "manual") as ToolRecovery,
    );
    while (!ctx.children().every((task) => task.status === "completed"))
      await new Promise((resolve) => setTimeout(resolve, 5));
    process.send?.({ id: ctx.id });
    await new Promise<void>(() => {
      setInterval(() => {}, 1000);
    });
    return { status: "completed", output };
  },
});
const runtime = await DurableRuntime.open({
  store: new SqliteDurableStore(database),
  tasks: [parent, child],
});
await runtime.submitTask(parent, { sessionId: "session", requestId: "parent", input: null });
