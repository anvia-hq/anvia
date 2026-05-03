import { describe, expect, it } from "vitest";
import { createThinkTool, ToolCallError, ToolSet } from "../src/index";

describe("createThinkTool", () => {
  it("creates the default think tool definition", async () => {
    const tool = createThinkTool();

    await expect(Promise.resolve(tool.definition(""))).resolves.toEqual({
      name: "think",
      description:
        "Use this tool to record a thought while reasoning through a complex task. It does not retrieve information, store memory, or change external state.",
      parameters: {
        type: "object",
        properties: {
          thought: {
            type: "string",
            description: "A thought to record while reasoning through a task.",
          },
        },
        required: ["thought"],
        additionalProperties: false,
      },
    });
  });

  it("returns the supplied thought", async () => {
    const toolSet = ToolSet.fromTools([createThinkTool()]);

    await expect(
      toolSet.call("think", JSON.stringify({ thought: "Check the intermediate sum." })),
    ).resolves.toBe("Check the intermediate sum.");
  });

  it("rejects invalid input through normal tool validation", async () => {
    const toolSet = ToolSet.fromTools([createThinkTool()]);

    await expect(toolSet.call("think", JSON.stringify({ thought: 42 }))).rejects.toBeInstanceOf(
      ToolCallError,
    );
  });

  it("allows name and description overrides", async () => {
    const tool = createThinkTool({
      name: "plan",
      description: "Record a plan before answering.",
    });

    await expect(Promise.resolve(tool.definition(""))).resolves.toMatchObject({
      name: "plan",
      description: "Record a plan before answering.",
    });
  });
});
