import { Message } from "@anvia/core";
import { describe, expect, it } from "vitest";
import {
  fallbackActivePage,
  isActivePageEnabled,
  type StudioPageAvailability,
} from "../src/ui/app/modules/shared/navigation";
import {
  findMatchingToolIndex,
  nextSequence,
  toHistory,
} from "../src/ui/app/modules/shared/transcript";

const baseAvailability: StudioPageAvailability = {
  hasAgents: true,
  sessionsEnabled: true,
  tracesEnabled: true,
  toolsEnabled: true,
  mcpsEnabled: true,
  pipelinesEnabled: true,
  evalsEnabled: true,
  memoryEnabled: true,
  statusEnabled: true,
  knowledgeEnabled: true,
};

describe("Studio UI helpers", () => {
  it("keeps pages enabled when their runtime capability is missing", () => {
    const availability = {
      ...baseAvailability,
      sessionsEnabled: false,
      tracesEnabled: false,
      toolsEnabled: false,
      mcpsEnabled: false,
      knowledgeEnabled: false,
    };

    expect(isActivePageEnabled("sessions", availability)).toBe(true);
    expect(isActivePageEnabled("tracing", availability)).toBe(true);
    expect(isActivePageEnabled("tools", availability)).toBe(true);
    expect(isActivePageEnabled("mcps", availability)).toBe(true);
    expect(isActivePageEnabled("knowledge", availability)).toBe(true);
    expect(isActivePageEnabled("agents", availability)).toBe(true);
  });

  it("preserves the preferred page instead of redirecting unavailable pages", () => {
    expect(
      fallbackActivePage("playground", {
        ...baseAvailability,
        hasAgents: false,
      }),
    ).toBe("playground");
    expect(
      fallbackActivePage("playground", {
        ...baseAvailability,
        hasAgents: false,
        pipelinesEnabled: false,
        evalsEnabled: false,
        sessionsEnabled: false,
        tracesEnabled: false,
      }),
    ).toBe("playground");
  });

  it("keeps transcript helper behavior deterministic", () => {
    const transcript = [
      { entryId: 4, kind: "message", role: "user", text: "Hello" },
      { entryId: 7, kind: "message", role: "assistant", text: "Hi" },
      { entryId: 8, kind: "tool", toolName: "lookup", callId: "call_1", args: "{}" },
    ] as const;

    expect(nextSequence([...transcript])).toBe(9);
    expect(findMatchingToolIndex([...transcript], "lookup", "call_1")).toBe(2);
    expect(toHistory([...transcript])).toEqual([Message.user("Hello"), Message.assistant("Hi")]);
  });
});
