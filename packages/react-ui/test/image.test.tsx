import type { UIAttachment, UIMessage } from "@anvia/client";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ChatProvider,
  ImagePrimitive as Image,
  MessagePrimitive as Message,
  ThreadPrimitive as Thread,
} from "../src";
import { createChatController } from "./helpers";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Image primitives", () => {
  it("renders direct image attachments and preview state", () => {
    const attachment = imageAttachment();

    render(
      <Image.Root attachment={attachment} data-testid="image-root">
        <Image.Preview loadingFallback="Loading" errorFallback="Broken" />
        <Image.Name />
      </Image.Root>,
    );

    expect(screen.getByTestId("image-root")).toBeInstanceOf(HTMLElement);
    expect(screen.getByText("Loading")).toBeTruthy();

    const image = screen.getByAltText("photo.png");
    expect(image).toBeInstanceOf(HTMLImageElement);
    fireEvent.load(image as HTMLImageElement);

    expect(screen.queryByText("Loading")).toBeNull();
    expect(screen.getByText("photo.png")).toBeTruthy();
  });

  it("uses message attachment context and opens a zoom overlay", async () => {
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

    const trigger = screen.getByText("Open") as HTMLButtonElement;
    trigger.focus();
    fireEvent.click(trigger);

    const overlay = screen.getByRole("dialog");
    expect(overlay).toBeInstanceOf(HTMLDivElement);
    expect(overlay?.getAttribute("aria-modal")).toBe("true");

    await waitFor(() => {
      expect(document.activeElement).toBe(overlay);
    });

    fireEvent.keyDown(overlay as HTMLDivElement, { key: "Tab" });
    expect(document.activeElement).toBe(overlay);

    fireEvent.keyDown(overlay as HTMLDivElement, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(document.activeElement).toBe(trigger);
    });
  });

  it("downloads image attachments through a blob URL", async () => {
    const attachment: UIAttachment = {
      id: "image_1",
      type: "image",
      name: "photo.png",
      mediaType: "image/png",
      url: "https://cdn.example.test/photo.png",
    };
    const blob = new Blob(["hello"], { type: "image/png" });
    const fetchImage = vi.fn(async () => ({
      blob: vi.fn(async () => blob),
    }));
    const createObjectURL = vi.fn(() => "blob:download");
    const revokeObjectURL = vi.fn();
    const clickedLinks: Array<{ download: string; href: string; rel: string }> = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clickedLinks.push({
        download: this.download,
        href: this.getAttribute("href") ?? "",
        rel: this.rel,
      });
    });
    const originalFetch = globalThis.fetch;
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;

    try {
      Object.defineProperty(globalThis, "fetch", {
        configurable: true,
        value: fetchImage,
      });
      Object.defineProperty(URL, "createObjectURL", {
        configurable: true,
        value: createObjectURL,
      });
      Object.defineProperty(URL, "revokeObjectURL", {
        configurable: true,
        value: revokeObjectURL,
      });

      render(
        <Image.Root attachment={attachment}>
          <Image.Download filename="download.png" />
        </Image.Root>,
      );

      fireEvent.click(screen.getByText("Download"));

      await waitFor(() => {
        expect(fetchImage).toHaveBeenCalledWith("https://cdn.example.test/photo.png");
      });
      expect(createObjectURL).toHaveBeenCalledWith(blob);
      expect(clickedLinks).toEqual([
        {
          download: "download.png",
          href: "blob:download",
          rel: "noopener",
        },
      ]);
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:download");
    } finally {
      click.mockRestore();
      Object.defineProperty(globalThis, "fetch", {
        configurable: true,
        value: originalFetch,
      });
      Object.defineProperty(URL, "createObjectURL", {
        configurable: true,
        value: originalCreateObjectURL,
      });
      Object.defineProperty(URL, "revokeObjectURL", {
        configurable: true,
        value: originalRevokeObjectURL,
      });
    }
  });

  it("gates non-image attachments and disables unavailable image actions", () => {
    const attachment: UIAttachment = {
      id: "file_1",
      type: "file",
      name: "report.csv",
      mediaType: "text/csv",
    };

    const { container, rerender } = render(<Image.Root attachment={attachment} />);
    expect(container.querySelector("figure")).toBeNull();

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
