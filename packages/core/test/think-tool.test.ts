import { describe, expect, it } from "vitest";
import { createThinkTool } from "./helpers/imports";

describe("createThinkTool", () => {
  it("creates the default think tool definition", async () => {
    const tool = createThinkTool();
    const definition = await Promise.resolve(tool.definition(""));

    expect(definition.name).toBe("think");
    expect(definition.description.length).toBeGreaterThan(0);
    expect(definition.parameters).toMatchObject({
      type: "object",
      properties: {
        thought: {
          type: "string",
          description: expect.any(String),
        },
      },
      required: ["thought"],
      additionalProperties: false,
    });
  });

  it("returns the supplied thought", async () => {
    const tool = createThinkTool();

    await expect(tool.call({ thought: "Check the intermediate sum." })).resolves.toBe(
      "Check the intermediate sum.",
    );
  });

  it("rejects invalid input through normal tool validation", async () => {
    const tool = createThinkTool();

    await expect(tool.call({ thought: 42 } as never)).rejects.toThrow();
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
