import { describe, expect, it } from "vitest";
import { Message } from "../../core/test/helpers/imports";
import { controlsForSelectedModel, userMessageWithAttachments } from "../src/ui/app/app-helpers";

describe("Studio UI helpers", () => {
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
