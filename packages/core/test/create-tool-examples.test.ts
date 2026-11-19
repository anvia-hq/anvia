import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createTool, type Tool } from "../src/tool";

const inputSchema = z.object({
  orderId: z.string(),
  reason: z.enum(["damaged", "late"]).optional(),
});

function refund(extra: Record<string, unknown> = {}): Tool<z.output<typeof inputSchema>, string> {
  return createTool({
    name: "issue_refund",
    description: "Issue a refund for a customer order.",
    inputSchema,
    handler: ({ orderId }) => orderId,
    ...extra,
  });
}

describe("tool examples", () => {
  it("appends the rendered example to the definition description", async () => {
    const tool = refund({
      examples: [
        { input: { orderId: "A-100", reason: "damaged" }, note: "when the box arrived crushed" },
      ],
    });

    const definition = await tool.definition("refund A-100");

    expect(definition.description).toBe(
      [
        "Issue a refund for a customer order.",
        "",
        "Examples:",
        '- issue_refund({"orderId":"A-100","reason":"damaged"}) when the box arrived crushed',
      ].join("\n"),
    );
  });

  it("leaves the description and parameters untouched without examples", async () => {
    const definition = await refund().definition("");

    expect(definition.description).toBe("Issue a refund for a customer order.");
    expect(definition.parameters).toMatchObject({ type: "object" });
  });

  it("validates every example against the input schema", () => {
    expect(() => refund({ examples: [{ input: { orderId: "A-100", reason: "lost" } }] })).toThrow();
    expect(() => refund({ examples: [{ input: {} }] })).toThrow();
  });

  it("rejects malformed example lists and notes", () => {
    expect(() => refund({ examples: [] })).toThrow(
      'Tool "issue_refund" examples must be a non-empty array when set.',
    );
    expect(() => refund({ examples: [{ input: { orderId: "A-100" }, note: 1 }] })).toThrow(
      'Tool "issue_refund" example 1 note must be a string.',
    );
  });

  it("renders stable JSON for non-JSON inputs", async () => {
    const tool = createTool({
      name: "count",
      description: "Count things.",
      inputSchema: z.object({ amount: z.number(), label: z.string() }),
      examples: [{ input: { amount: 2, label: "boxes" } }],
      handler: () => "2",
    });

    expect((await tool.definition("")).description).toBe(
      ["Count things.", "", "Examples:", '- count({"amount":2,"label":"boxes"})'].join("\n"),
    );
  });

  it("gives each definition call its own parameters object", async () => {
    const tool = refund({ examples: [{ input: { orderId: "A-100" } }] });

    const first = await tool.definition("");
    const second = await tool.definition("");

    expect(first.parameters).not.toBe(second.parameters);
    expect(first.description).toBe(second.description);
  });
});
