import { describe, expect, it } from "vitest";
import { Message } from "../../core/test/helpers/imports";
import { controlsForSelectedModel, userMessageWithAttachments } from "../src/ui/app/app-helpers";
import {
  fallbackActivePage,
  isActivePageEnabled,
  navigationSection,
  type StudioPageAvailability,
} from "../src/ui/app/modules/shared/navigation";
import {
  findMatchingToolIndex,
  nextSequence,
  toHistory,
} from "../src/ui/app/modules/shared/transcript";

const baseAvailability: StudioPageAvailability = {
  hasAgents: true,
  graphsEnabled: true,
  sessionsEnabled: true,
  tracesEnabled: true,
  toolsEnabled: true,
  sandboxesEnabled: true,
  mcpsEnabled: true,
  pipelinesEnabled: true,
  memoryEnabled: true,
  statusEnabled: true,
  knowledgeEnabled: true,
};

describe("Studio UI helpers", () => {
  it("groups every Studio page into the Lens shell sections", () => {
    expect(
      ["playground", "pipelines", "sessions", "tracing"].map((page) =>
        navigationSection(page as Parameters<typeof navigationSection>[0]),
      ),
    ).toEqual(Array(4).fill("workspace"));
    expect(
      ["agents", "tools", "sandboxes", "mcps", "graphs", "knowledge", "memory", "status"].map(
        (page) => navigationSection(page as Parameters<typeof navigationSection>[0]),
      ),
    ).toEqual(Array(8).fill("inspect"));
  });

  it("keeps pages enabled when their runtime capability is missing", () => {
    const availability = {
      ...baseAvailability,
      sessionsEnabled: false,
      tracesEnabled: false,
      toolsEnabled: false,
      sandboxesEnabled: false,
      mcpsEnabled: false,
      knowledgeEnabled: false,
    };

    expect(isActivePageEnabled("sessions", availability)).toBe(true);
    expect(isActivePageEnabled("tracing", availability)).toBe(true);
    expect(isActivePageEnabled("tools", availability)).toBe(true);
    expect(isActivePageEnabled("sandboxes", availability)).toBe(true);
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
    expect(toHistory([...transcript])).toEqual([
      Message.user([{ type: "text", text: "Hello" }]),
      Message.assistant("Hi"),
    ]);
  });

  it("creates UI messages for multimodal prompts that round-trip to core messages", () => {
    const message = userMessageWithAttachments("Describe", [
      {
        id: "attachment_1",
        name: "image.png",
        mediaType: "image/png",
        kind: "image",
        data: "iVBORw0KGgo=",
        size: 12,
      },
    ]);

    expect(message).toEqual(
      Message.user([
        { type: "text", text: "Describe" },
        {
          type: "image",
          image: { type: "data", data: "iVBORw0KGgo=" },
          mediaType: "image/png",
        },
      ]),
    );
  });

  it("clears controls without a model while preserving them during model loading", () => {
    const controls = { reasoningEffort: "high" };

    expect(controlsForSelectedModel("", undefined, controls)).toEqual({});
    expect(controlsForSelectedModel("test:reasoning", undefined, controls)).toBe(controls);
    expect(
      controlsForSelectedModel(
        "test:reasoning",
        {
          id: "reasoning",
          ref: "test:reasoning",
          providerId: "test",
          controls: {
            reasoningEffort: {
              type: "select",
              label: "Reasoning effort",
              options: ["low"],
            },
          },
        },
        controls,
      ),
    ).toEqual({});
    expect(
      controlsForSelectedModel(
        "test:reasoning",
        { id: "reasoning", ref: "test:reasoning", providerId: "test" },
        JSON.parse('{"toString":"high"}') as Record<string, string>,
      ),
    ).toEqual({});
  });
});
