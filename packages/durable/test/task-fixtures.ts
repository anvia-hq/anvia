import { z } from "zod";
import { defineTask } from "../src/index.js";
export const waiting = defineTask({
  name: "wait",
  version: 1,
  input: z.null(),
  checkpoint: z.null(),
  output: z.string(),
  initial: () => null,
  run: async (ctx) =>
    ctx.signalValue("go") === undefined
      ? { status: "waiting", checkpoint: null, wait: { type: "signal", name: "go" } }
      : { status: "completed", output: "done" },
});
export const parent = defineTask({
  name: "parent",
  version: 1,
  input: z.null(),
  checkpoint: z.null(),
  output: z.null(),
  initial: () => null,
  run: async (ctx) => {
    ctx.spawnAgent("agent", { agentId: "researcher", prompt: "hi" });
    return { status: "waiting", checkpoint: null, wait: { type: "signal", name: "go" } };
  },
});

export function deferredParent(released: Promise<void>) {
  return defineTask({
    name: "deferred",
    version: 1,
    input: z.null(),
    checkpoint: z.null(),
    output: z.null(),
    initial: () => null,
    run: async (ctx) => {
      await released;
      ctx.spawnAgent("late", { agentId: "researcher", prompt: "hi" });
      return { status: "waiting", checkpoint: null, wait: { type: "signal", name: "go" } };
    },
  });
}
