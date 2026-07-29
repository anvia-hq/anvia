import { startObservation } from "@langfuse/tracing";
import { describe, expect, it } from "vitest";

describe("Langfuse SDK lifecycle", () => {
  it("creates instantaneous event observations without explicitly ending them", () => {
    const root = startObservation("agent.run", {}, { asType: "agent" });

    const event = root.startObservation("checkpoint", {}, { asType: "event" });

    expect(event.id).toBeTypeOf("string");
    expect(event.traceId).toBe(root.traceId);
    root.end();
  });
});
