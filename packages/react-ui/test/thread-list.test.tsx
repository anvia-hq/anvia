import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ThreadList, type ThreadListController, ThreadListItem, ThreadListProvider } from "../src";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ThreadList primitives", () => {
  it("throws outside ThreadListProvider", () => {
    expect(() => render(<ThreadList.Root />)).toThrow(
      "ThreadList primitives must be used inside ThreadListProvider.",
    );
  });

  it("renders filtered thread items and calls controller actions", () => {
    const createThread = vi.fn();
    const switchThread = vi.fn();
    const archiveThread = vi.fn();
    const unarchiveThread = vi.fn();
    const deleteThread = vi.fn();
    const controller = createThreadListController({
      activeThreadId: "thread_1",
      createThread,
      switchThread,
      archiveThread,
      unarchiveThread,
      deleteThread,
    });

    const { container } = render(
      <ThreadListProvider controller={controller}>
        <ThreadList.Root>
          <ThreadList.New />
          <ThreadList.Items>
            {(thread) => (
              <ThreadListItem.Root>
                <ThreadListItem.Trigger>
                  <ThreadListItem.Title fallback="Untitled" />
                </ThreadListItem.Trigger>
                <ThreadListItem.Archive />
                <ThreadListItem.Delete />
                <span>{thread.id}</span>
              </ThreadListItem.Root>
            )}
          </ThreadList.Items>
          <ThreadList.Items archived>
            <ThreadListItem.Root>
              <ThreadListItem.Title />
              <ThreadListItem.Unarchive />
            </ThreadListItem.Root>
          </ThreadList.Items>
        </ThreadList.Root>
      </ThreadListProvider>,
    );

    expect(screen.getByText("First")).toBeTruthy();
    expect(screen.getByText("Archived")).toBeTruthy();
    expect(
      container.querySelector('[data-thread-id="thread_1"]')?.getAttribute("data-active"),
    ).toBe("");

    fireEvent.click(screen.getByText("New chat"));
    fireEvent.click(screen.getByText("Second"));
    fireEvent.click(screen.getAllByText("Archive")[0] as HTMLButtonElement);
    fireEvent.click(screen.getAllByText("Delete")[0] as HTMLButtonElement);
    fireEvent.click(screen.getByText("Unarchive"));

    expect(createThread).toHaveBeenCalledTimes(1);
    expect(switchThread).toHaveBeenCalledWith("thread_2");
    expect(archiveThread).toHaveBeenCalledWith("thread_1");
    expect(deleteThread).toHaveBeenCalledWith("thread_1");
    expect(unarchiveThread).toHaveBeenCalledWith("thread_3");
  });

  it("keeps empty collections mounted when requested and renders empty state", () => {
    render(
      <ThreadListProvider controller={createThreadListController({ threads: [] })}>
        <ThreadList.Root>
          <ThreadList.Items data-testid="items" keepMounted />
          <ThreadList.Empty>No chats</ThreadList.Empty>
        </ThreadList.Root>
      </ThreadListProvider>,
    );

    expect(screen.getByTestId("items").getAttribute("data-empty")).toBe("");
    expect(screen.getByText("No chats")).toBeTruthy();
  });

  it("moves focus through triggers with keyboard navigation", () => {
    render(
      <ThreadListProvider controller={createThreadListController()}>
        <ThreadList.Root data-testid="root">
          <ThreadList.Items />
        </ThreadList.Root>
      </ThreadListProvider>,
    );

    const root = screen.getByTestId("root");
    const triggers = screen.getAllByRole("button");
    triggers[0]?.focus();

    fireEvent.keyDown(root, { key: "ArrowDown" });
    expect(document.activeElement).toBe(triggers[1]);

    fireEvent.keyDown(root, { key: "End" });
    expect(document.activeElement).toBe(triggers[1]);

    fireEvent.keyDown(root, { key: "ArrowUp" });
    expect(document.activeElement).toBe(triggers[0]);
  });

  it("disables item actions when controller methods are absent", () => {
    const { archiveThread: _archiveThread, ...controller } = createThreadListController();
    render(
      <ThreadListProvider controller={controller}>
        <ThreadList.Root>
          <ThreadList.Items>
            <ThreadListItem.Root>
              <ThreadListItem.Archive />
            </ThreadListItem.Root>
          </ThreadList.Items>
        </ThreadList.Root>
      </ThreadListProvider>,
    );

    expect((screen.getAllByText("Archive")[0] as HTMLButtonElement).disabled).toBe(true);
  });
});

function createThreadListController(
  overrides: Partial<ThreadListController> = {},
): ThreadListController {
  const controller: ThreadListController = {
    threads: [
      { id: "thread_1", title: "First" },
      { id: "thread_2", title: "Second" },
      { id: "thread_3", title: "Archived", archived: true },
    ],
    createThread: vi.fn(),
    switchThread: vi.fn(),
  };
  return {
    ...controller,
    ...overrides,
  };
}
