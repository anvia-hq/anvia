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
  it("marks pages disabled when their runtime capability is missing", () => {
    const availability = {
      ...baseAvailability,
      sessionsEnabled: false,
      tracesEnabled: false,
      toolsEnabled: false,
      mcpsEnabled: false,
      knowledgeEnabled: false,
    };

    expect(isActivePageEnabled("sessions", availability)).toBe(false);
    expect(isActivePageEnabled("tracing", availability)).toBe(false);
    expect(isActivePageEnabled("tools", availability)).toBe(false);
    expect(isActivePageEnabled("mcps", availability)).toBe(false);
    expect(isActivePageEnabled("knowledge", availability)).toBe(false);
    expect(isActivePageEnabled("agents", availability)).toBe(true);
  });

  it("falls back to the first available operational page", () => {
    expect(
      fallbackActivePage("playground", {
        ...baseAvailability,
        hasAgents: false,
      }),
    ).toBe("pipelines");
    expect(
      fallbackActivePage("playground", {
        ...baseAvailability,
        hasAgents: false,
        pipelinesEnabled: false,
        evalsEnabled: false,
        sessionsEnabled: false,
        tracesEnabled: false,
      }),
    ).toBe("agents");
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
