import { describe, expect, it } from "vitest";
import { AssistantContent, Message, reasoningDisplayText, UserContent } from "../src/index";

describe("message attachment content", () => {
  it("creates user image and document attachments", () => {
    expect(
      Message.user([
        UserContent.text("Inspect this."),
        UserContent.imageUrl("https://example.com/image.png", { detail: "auto" }),
        UserContent.imageBase64("abc123", "image/png", { detail: "high" }),
        UserContent.documentBase64("pdf123", "application/pdf", { filename: "report.pdf" }),
      ]),
    ).toEqual({
      role: "user",
      content: [
        { type: "text", text: "Inspect this." },
        {
          type: "image",
          source: { type: "url", url: "https://example.com/image.png" },
          detail: "auto",
        },
        {
          type: "image",
          source: { type: "base64", data: "abc123", mediaType: "image/png" },
          detail: "high",
        },
        {
          type: "document",
          source: {
            type: "base64",
            data: "pdf123",
            mediaType: "application/pdf",
            filename: "report.pdf",
          },
        },
      ],
    });
  });

  it("creates assistant image history content", () => {
    expect(Message.assistant([AssistantContent.imageBase64("abc123", "image/png")])).toEqual({
      role: "assistant",
      content: [
        {
          type: "image",
          source: { type: "base64", data: "abc123", mediaType: "image/png" },
        },
      ],
    });
  });

  it("keeps legacy reasoning content shape and supports structured reasoning", () => {
    expect(AssistantContent.reasoning("Think once.", "rs_1")).toEqual({
      type: "reasoning",
      text: "Think once.",
      id: "rs_1",
    });

    const reasoning = AssistantContent.reasoningFromContent(
      [
        { type: "summary", text: "Checked the plan." },
        { type: "encrypted", data: "opaque" },
        { type: "text", text: "Visible thinking.", signature: "sig_1" },
        { type: "redacted", data: "redacted" },
      ],
      "rs_2",
    );

    expect(reasoning).toEqual({
      type: "reasoning",
      id: "rs_2",
      text: "Checked the plan.Visible thinking.",
      content: [
        { type: "summary", text: "Checked the plan." },
        { type: "encrypted", data: "opaque" },
        { type: "text", text: "Visible thinking.", signature: "sig_1" },
        { type: "redacted", data: "redacted" },
      ],
    });
    expect(reasoningDisplayText(reasoning)).toBe("Checked the plan.Visible thinking.");
  });
});
