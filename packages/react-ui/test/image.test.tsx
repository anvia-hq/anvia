import type { UIAttachment, UIMessage } from "@anvia/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChatProvider, Image, Message, Thread } from "../src";
import { createChatController } from "./helpers";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Image primitives", () => {
  it("renders direct image attachments and preview state", () => {
    const attachment = imageAttachment();

    const { container } = render(
      <Image.Root attachment={attachment}>
        <Image.Preview loadingFallback="Loading" errorFallback="Broken" />
        <Image.Name />
      </Image.Root>,
    );

    expect(container.querySelector("[data-anvia-image]")).toBeInstanceOf(HTMLElement);
    expect(screen.getByText("Loading")).toBeTruthy();

    const image = container.querySelector("[data-anvia-image-img]");
    expect(image).toBeInstanceOf(HTMLImageElement);
    fireEvent.load(image as HTMLImageElement);

    expect(screen.queryByText("Loading")).toBeNull();
    expect(screen.getByText("photo.png")).toBeTruthy();
  });

  it("uses message attachment context and opens a zoom overlay", () => {
    const messages: UIMessage[] = [
      {
        id: "assistant_1",
        role: "assistant",
        parts: [{ id: "part_1", type: "attachment", attachment: imageAttachment() }],
      },
    ];

    render(
      <ChatProvider controller={createChatController({ messages })}>
        <Thread.Root>
          <Thread.Messages>
            <Message.Root>
              <Message.Parts>
                <Message.Part>
                  <Message.Attachment>
                    <Image.Root>
                      <Image.ZoomTrigger>Open</Image.ZoomTrigger>
                      <Image.ZoomOverlay />
                    </Image.Root>
                  </Message.Attachment>
                </Message.Part>
              </Message.Parts>
            </Message.Root>
          </Thread.Messages>
        </Thread.Root>
      </ChatProvider>,
    );

    fireEvent.click(screen.getByText("Open"));

    const overlay = document.querySelector("[data-anvia-image-zoom-overlay]");
    expect(overlay).toBeInstanceOf(HTMLDivElement);

    fireEvent.click(overlay as HTMLDivElement);
    expect(document.querySelector("[data-anvia-image-zoom-overlay]")).toBeNull();
  });

  it("gates non-image attachments and disables unavailable image actions", () => {
    const attachment: UIAttachment = {
      id: "file_1",
      type: "file",
      name: "report.csv",
      mediaType: "text/csv",
    };

    const { container, rerender } = render(<Image.Root attachment={attachment} />);
    expect(container.querySelector("[data-anvia-image]")).toBeNull();

    rerender(
      <Image.Root attachment={{ ...attachment, type: "image" }} renderWhen="always">
        <Image.Copy />
        <Image.Download />
      </Image.Root>,
    );

    expect((screen.getByText("Copy image") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText("Download") as HTMLButtonElement).disabled).toBe(true);
  });
});

function imageAttachment(): UIAttachment {
  return {
    id: "image_1",
    type: "image",
    name: "photo.png",
    mediaType: "image/png",
    data: "aGVsbG8=",
  };
}
