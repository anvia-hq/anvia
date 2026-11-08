import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import { createTool, type CreateToolOptions } from "../src/tool/index.js";

const inputSchema = z.object({ x: z.number(), y: z.number() });

describe("createTool handler", () => {
  it("runs handler with validated input and the call context", async () => {
    const tool = createTool({
      name: "add",
      description: "Add",
      inputSchema,
      outputSchema: z.number(),
      handler: (args, context) => {
        expect(context.operationId).toBe("op-1");
        return args.x + args.y;
      },
    });
    await expect(tool.call({ x: 1, y: 2 }, { operationId: "op-1" })).resolves.toBe(3);
    await expect(tool.call({ x: "1", y: 2 } as never)).rejects.toThrow();
  });

  it("still runs the deprecated execute with identical behaviour", async () => {
    const make = (kind: "handler" | "execute") => {
      const run = (args: { x: number; y: number }) => args.x + args.y;
      return kind === "handler"
        ? createTool({ name: "add", description: "Add", inputSchema, handler: run })
        : createTool({ name: "add", description: "Add", inputSchema, execute: run });
    };
    const viaHandler = make("handler");
    const viaExecute = make("execute");
    expect(await viaExecute.definition("")).toEqual(await viaHandler.definition(""));
    await expect(viaExecute.call({ x: 2, y: 3 })).resolves.toBe(
      await viaHandler.call({ x: 2, y: 3 }),
    );
  });

  it("rejects a tool that sets both or neither", () => {
    const both = { name: "t", description: "t", inputSchema, handler: () => 1, execute: () => 1 };
    expect(() => createTool(both as never)).toThrow('sets both "handler" and "execute"');
    const neither = { name: "t", description: "t", inputSchema };
    expect(() => createTool(neither as never)).toThrow('requires a "handler" function');
  });

  it("infers argument and output types from handler", () => {
    const tool = createTool({
      name: "add",
      description: "Add",
      inputSchema,
      outputSchema: z.object({ sum: z.number() }),
      handler: (args) => {
        expectTypeOf(args).toEqualTypeOf<{ x: number; y: number }>();
        return { sum: args.x + args.y };
      },
    });
    expectTypeOf(tool.call).returns.resolves.toEqualTypeOf<{ sum: number }>();
  });

  it("does not accept both options in the types", () => {
    type Options = CreateToolOptions<typeof inputSchema>;
    expectTypeOf<Options>().not.toMatchTypeOf<{ handler: () => 1; execute: () => 1 }>();
    // @ts-expect-error a tool needs a handler (or the deprecated execute)
    const missing: Options = { name: "t", description: "t", inputSchema };
    void missing;
  });
});
