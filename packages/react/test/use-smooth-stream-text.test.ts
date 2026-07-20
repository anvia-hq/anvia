import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SmoothStreamItemAdapter } from "../src";
import { useSmoothStreamItems, useSmoothStreamText } from "../src";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("@anvia/react stream smoothing hooks", () => {
  it("seeds initial content without replaying it", () => {
    const clock = installAnimationFrame();
    const { result } = renderHook(() =>
      useSmoothStreamText("Loaded history", {
        isStreaming: false,
        resetKey: "session-1",
      }),
    );

    expect(result.current.text).toBe("Loaded history");
    expect(result.current.isAnimating).toBe(false);
    expect(clock.request).not.toHaveBeenCalled();
  });

  it("buffers an append before revealing it at an elapsed-time rate", () => {
    const clock = installAnimationFrame();
    const { result, rerender } = renderHook(
      ({ content }) =>
        useSmoothStreamText(content, {
          isStreaming: true,
          resetKey: "message-1",
        }),
      { initialProps: { content: "A" } },
    );

    rerender({ content: "ABCDEFGHIJKLMNO" });
    expect(result.current.text).toBe("A");
    expect(result.current.isAnimating).toBe(true);

    act(() => clock.advance(200));
    expect(result.current.text).toBe("A");

    act(() => clock.advance(50));
    expect(result.current.text.startsWith("A")).toBe(true);
    expect(result.current.text.length).toBeGreaterThan(1);
    expect(result.current.text).not.toBe("ABCDEFGHIJKLMNO");
  });

  it("drains buffered text instead of snapping when streaming completes", () => {
    const clock = installAnimationFrame();
    const { result, rerender } = renderHook(
      ({ content, isStreaming }) =>
        useSmoothStreamText(content, {
          isStreaming,
          resetKey: "message-1",
        }),
      { initialProps: { content: "", isStreaming: true } },
    );

    rerender({ content: "A response that still has buffered text", isStreaming: true });
    act(() => clock.advance(250));
    expect(result.current.text).not.toBe("A response that still has buffered text");

    rerender({ content: "A response that still has buffered text", isStreaming: false });
    expect(result.current.isDraining).toBe(true);
    expect(result.current.text).not.toBe("A response that still has buffered text");

    drainAnimationFrames(clock, 1_000);
    expect(result.current.text).toBe("A response that still has buffered text");
    expect(result.current.isDraining).toBe(false);
  });

  it("flushes immediately for fatal source errors", () => {
    const clock = installAnimationFrame();
    const { result, rerender } = renderHook(
      ({ content, flushImmediately }) =>
        useSmoothStreamText(content, {
          flushImmediately,
          isStreaming: true,
          resetKey: "message-1",
        }),
      { initialProps: { content: "", flushImmediately: false } },
    );

    rerender({ content: "Partial response", flushImmediately: false });
    expect(result.current.text).toBe("");

    rerender({ content: "Partial response", flushImmediately: true });
    expect(result.current.text).toBe("Partial response");
    expect(result.current.isAnimating).toBe(false);
    expect(clock.cancel).toHaveBeenCalled();
  });

  it("uses resetKey to seed a newly selected stream", () => {
    const clock = installAnimationFrame();
    const { result, rerender } = renderHook(
      ({ content, resetKey }) =>
        useSmoothStreamText(content, {
          isStreaming: true,
          resetKey,
        }),
      { initialProps: { content: "First", resetKey: "session-1" } },
    );

    rerender({ content: "First response continues", resetKey: "session-1" });
    expect(result.current.text).toBe("First");

    rerender({ content: "Loaded second session", resetKey: "session-2" });
    expect(result.current.text).toBe("Loaded second session");
    expect(result.current.isAnimating).toBe(false);
    expect(clock.cancel).toHaveBeenCalled();
  });

  it("keeps composed graphemes intact", () => {
    const clock = installAnimationFrame();
    const family = "👨‍👩‍👧‍👦";
    const target = family.repeat(10);
    const { result, rerender } = renderHook(
      ({ content }) =>
        useSmoothStreamText(content, {
          isStreaming: true,
          resetKey: "message-1",
        }),
      { initialProps: { content: "" } },
    );

    rerender({ content: target });
    act(() => clock.advance(250));

    expect(result.current.text.length).toBeGreaterThan(0);
    expect(target.startsWith(result.current.text)).toBe(true);
    const revealedGraphemes = [
      ...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(result.current.text),
    ];
    expect(revealedGraphemes.length).toBeLessThan(10);
    expect(revealedGraphemes.every((segment) => segment.segment === family)).toBe(true);
  });

  it("preserves item ordering and applies visible opaque updates immediately", () => {
    const clock = installAnimationFrame();
    const adapter: SmoothStreamItemAdapter<TestItem> = {
      getKey: (item) => item.id,
      getText: (item) => (item.kind === "text" ? item.text : undefined),
      withText: (item, text) => (item.kind === "text" ? { ...item, text } : item),
    };
    const { result, rerender } = renderHook(
      ({ items, isStreaming }) =>
        useSmoothStreamItems(items, {
          adapter,
          isStreaming,
          resetKey: "turn-1",
        }),
      { initialProps: { items: [] as TestItem[], isStreaming: true } },
    );

    rerender({
      items: [
        { id: "text-1", kind: "text", text: "Text before a tool call" },
        { id: "tool-1", kind: "tool", status: "running" },
      ],
      isStreaming: true,
    });
    act(() => clock.advance(250));
    expect(result.current.items.map((item) => item.id)).toEqual(["text-1"]);
    expect(result.current.liveItemKey).toBe("text-1");

    drainAnimationFrames(clock, 1_000);
    expect(result.current.items.map((item) => item.id)).toEqual(["text-1", "tool-1"]);
    expect(result.current.liveItemKey).toBeNull();

    rerender({
      items: [
        { id: "text-1", kind: "text", text: "Text before a tool call" },
        { id: "tool-1", kind: "tool", status: "done" },
      ],
      isStreaming: true,
    });
    expect(result.current.items[1]).toEqual({ id: "tool-1", kind: "tool", status: "done" });
  });

  it("flushes when animation frames are unavailable", () => {
    const clock = installAnimationFrame();
    vi.stubGlobal("requestAnimationFrame", undefined);
    const { result, rerender } = renderHook(
      ({ content }) =>
        useSmoothStreamText(content, {
          isStreaming: true,
          resetKey: "message-1",
        }),
      { initialProps: { content: "" } },
    );

    rerender({ content: "No animation frame support" });
    expect(result.current.text).toBe("No animation frame support");
    expect(result.current.isAnimating).toBe(false);
    expect(clock.request).not.toHaveBeenCalled();
  });

  it("cancels a scheduled frame on unmount", () => {
    const clock = installAnimationFrame();
    const { rerender, unmount } = renderHook(
      ({ content }) =>
        useSmoothStreamText(content, {
          isStreaming: true,
          resetKey: "message-1",
        }),
      { initialProps: { content: "" } },
    );

    rerender({ content: "Pending" });
    unmount();
    expect(clock.cancel).toHaveBeenCalledTimes(1);
  });
});

type TestItem =
  | { id: string; kind: "text"; text: string }
  | { id: string; kind: "tool"; status: string };

type AnimationFrameHarness = ReturnType<typeof installAnimationFrame>;

function installAnimationFrame() {
  let now = 0;
  let nextId = 0;
  const callbacks = new Map<number, FrameRequestCallback>();
  vi.spyOn(performance, "now").mockImplementation(() => now);
  const request = vi.fn((callback: FrameRequestCallback) => {
    const id = ++nextId;
    callbacks.set(id, callback);
    return id;
  });
  const cancel = vi.fn((id: number) => {
    callbacks.delete(id);
  });
  vi.stubGlobal("requestAnimationFrame", request);
  vi.stubGlobal("cancelAnimationFrame", cancel);

  return {
    cancel,
    pending: () => callbacks.size,
    request,
    advance(durationMs: number) {
      const target = now + durationMs;
      while (callbacks.size > 0 && now < target) {
        now = Math.min(target, now + 1_000 / 60);
        const pending = [...callbacks.values()];
        callbacks.clear();
        for (const callback of pending) {
          callback(now);
        }
      }
      now = target;
    },
  };
}

function drainAnimationFrames(clock: AnimationFrameHarness, durationMs: number): void {
  act(() => clock.advance(durationMs));
  expect(clock.pending()).toBe(0);
}
