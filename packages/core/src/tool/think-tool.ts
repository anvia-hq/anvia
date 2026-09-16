import { z } from "zod";
import { createTool } from "./create-tool";

const defaultThinkToolDescription =
  "Use this tool as a scratchpad to think through complex tasks step by step. Break the task into smaller steps, assess available information, and decide what to do next. Revisit your plan as new information becomes available. It does not retrieve information, store memory, or change external state.";

const thinkToolInput = z.object({
  thought: z.string().describe("A thought to record while reasoning through a task."),
});

export type CreateThinkToolOptions = {
  name?: string;
  description?: string;
};

export function createThinkTool(options: CreateThinkToolOptions = {}) {
  return createTool({
    name: options.name ?? "think",
    description: options.description ?? defaultThinkToolDescription,
    inputSchema: thinkToolInput,
    outputSchema: z.string(),
    execute: (args) => args.thought,
  });
}
