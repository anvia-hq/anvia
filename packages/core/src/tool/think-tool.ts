import { z } from "zod";
import { createTool } from "./create-tool";

const defaultThinkToolDescription =
  "Use this tool to record a thought while reasoning through a complex task. It does not retrieve information, store memory, or change external state.";

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
    input: thinkToolInput,
    output: z.string(),
    execute: (args) => args.thought,
  });
}
