import type { UIAttachment, UIMessage } from "@anvia/client";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ChatProvider, MessagePrimitive as Message, ThreadPrimitive as Thread } from "../src";
import { createChatController } from "./helpers";

afterEach(() => {
  cleanup();
});

function renderAttachment(attachment: UIAttachment) {
  const messages: UIMessage[] = [
    {
      id: "assistant_1",
      role: "assistant",
      parts: [{ id: "part_1", type: "attachment", attachment }],
    },
  ];

  return render(
    <ChatProvider controller={createChatController({ messages })}>
      <Thread.Root>
        <Thread.Messages>
          <Message.Root>
            <Message.Parts>
              <Message.Part>
                <Message.Attachment />
              </Message.Part>
            </Message.Parts>
          </Message.Root>
        </Thread.Messages>
      </Thread.Root>
    </ChatProvider>,
  );
}

function fileAttachment(url: string): UIAttachment {
  return { id: "file_1", type: "file", name: "notes.txt", mediaType: "text/plain", url };
}

function urlImageAttachment(url: string): UIAttachment {
  return { id: "image_1", type: "image", name: "photo.png", mediaType: "image/png", url };
}

describe("attachment URL safety", () => {
  it("renders the label without a link for an active URL scheme", () => {
    renderAttachment(fileAttachment("javascript:alert(document.cookie)"));

    expect(screen.getByText("notes.txt")).toBeTruthy();
    expect(document.querySelector("a[href]")).toBeNull();
  });

  it("rejects a scheme with embedded whitespace or control characters", () => {
    renderAttachment(fileAttachment("java\nscript:alert(1)"));

    expect(document.querySelector("a[href]")).toBeNull();
  });

  it("keeps http and https links", () => {
    renderAttachment(fileAttachment("https://example.com/report.pdf"));

    expect(screen.getByRole("link").getAttribute("href")).toBe("https://example.com/report.pdf");
  });

  it("keeps relative links", () => {
    renderAttachment(fileAttachment("/files/1"));

    expect(screen.getByRole("link").getAttribute("href")).toBe("/files/1");
  });

  it("drops an image whose URL uses an active scheme", () => {
    renderAttachment(urlImageAttachment("javascript:alert(1)"));

    expect(document.querySelector("img")).toBeNull();
  });

  it("keeps http image sources", () => {
    renderAttachment(urlImageAttachment("https://example.com/photo.png"));

    expect(document.querySelector("img")?.getAttribute("src")).toBe(
      "https://example.com/photo.png",
    );
  });
});
