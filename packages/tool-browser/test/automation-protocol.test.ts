import { describe, expect, it } from "vitest";
import { isAutomationResponse, summarizeAutomationMessage } from "../src/automation-protocol";

describe("automation worker response protocol", () => {
  it.each([
    { kind: "response", id: 1, ok: true, value: undefined },
    {
      kind: "response",
      id: 2,
      ok: false,
      error: { name: "Error", message: "connection failed" },
    },
    { kind: "cancelled", id: 3 },
    { kind: "event", event: "disconnected" },
  ])("accepts a valid $kind message", (message) => {
    expect(isAutomationResponse(message)).toBe(true);
  });

  it.each([
    undefined,
    null,
    [],
    { kind: "response", id: 0, ok: true, value: undefined },
    { kind: "response", id: 1, ok: true },
    { kind: "response", id: 1, ok: "true", value: undefined },
    { kind: "response", id: 1, ok: false, error: { message: "missing name" } },
    { kind: "cancelled", id: -1 },
    { kind: "event", event: "other" },
    { "watch:import": ["file:///private/application.ts"] },
  ])("rejects malformed or non-protocol input", (message) => {
    expect(isAutomationResponse(message)).toBe(false);
  });

  it("summarizes rejected input without retaining values or unknown property names", () => {
    const summary = summarizeAutomationMessage({
      kind: "not-a-protocol-kind",
      id: "private-id",
      ok: "private-status",
      "private-property-name": "private-value",
      "watch:import": ["file:///private/application.ts"],
    });

    expect(summary).toEqual({
      type: "object",
      ownPropertyNames: ["kind", "id", "ok", "<other>", "watch:import"],
      ownPropertyCount: 5,
      kind: "other",
      id: "non-number",
      ok: "non-boolean",
      constructorName: "Object",
      hasExpectedPrototype: true,
      hasRequiredFields: false,
    });
    expect(JSON.stringify(summary)).not.toContain("private");
  });
});
