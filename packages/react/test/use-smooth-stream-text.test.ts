import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { StreamSmoothingPreset } from "../src";
import { useSmoothStreamText } from "../src";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("@anvia/react useSmoothStreamText", () => {
  it("returns full content when disabled", () => {
    const raf = installAnimationFrame();
    const { result, rerender } = renderHook(
      ({ content }) => useSmoothStreamText(content, { enabled: false }),
      { initialProps: { content: "Hello" } },
    );

    rerender({ content: "Hello world" });

    expect(result.current.text).toBe("Hello world");
    expect(result.current.isAnimating).toBe(false);
    expect(raf.request).not.toHaveBeenCalled();
  });

  it("returns full content in none mode", () => {
    const raf = installAnimationFrame();
    const { result, rerender } = renderHook(
      ({ content }) => useSmoothStreamText(content, { mode: "none" }),
      { initialProps: { content: "Hello" } },
    );

    rerender({ content: "Hello world" });

    expect(result.current.text).toBe("Hello world");
    expect(result.current.isAnimating).toBe(false);
    expect(raf.request).not.toHaveBeenCalled();
  });

  it("progressively reveals appended Unicode characters while streaming", () => {
    const raf = installAnimationFrame();
    const { result, rerender } = renderHook(
      ({ content }) => useSmoothStreamText(content, { reducedMotion: false }),
      { initialProps: { content: "A" } },
    );

    rerender({ content: "A🙂🙃😉😊" });

    expect(result.current.text).toBe("A");
    expect(result.current.isAnimating).toBe(true);

    act(() => raf.step());

    expect(result.current.text).toBe("A🙂");
    expect(result.current.isAnimating).toBe(true);

    drainAnimationFrames(raf);

    expect(result.current.text).toBe("A🙂🙃😉😊");
    expect(result.current.isAnimating).toBe(false);
  });

  it.each([
    ["realtime", 20],
    ["balanced", 10],
    ["silky", 5],
  ] as const)("uses adaptive %s preset pacing", (preset, expectedLength) => {
    const raf = installAnimationFrame();
    const content = "x".repeat(40);
    const { result, rerender } = renderHook(
      ({ value, smoothingPreset }: { value: string; smoothingPreset: StreamSmoothingPreset }) =>
        useSmoothStreamText(value, { preset: smoothingPreset, reducedMotion: false }),
      { initialProps: { value: "", smoothingPreset: preset } },
    );

    rerender({ value: content, smoothingPreset: preset });
    act(() => raf.step());

    expect(result.current.text).toBe("x".repeat(expectedLength));
  });

  it("flushes queued text immediately", () => {
    const raf = installAnimationFrame();
    const { result, rerender } = renderHook(
      ({ content }) => useSmoothStreamText(content, { reducedMotion: false }),
      { initialProps: { content: "A" } },
    );

    rerender({ content: "ABCDE" });
    expect(result.current.isAnimating).toBe(true);

    act(() => result.current.flush());

    expect(result.current.text).toBe("ABCDE");
    expect(result.current.isAnimating).toBe(false);
    expect(raf.cancel).toHaveBeenCalled();
  });

  it("resets its internal target and displayed text", () => {
    installAnimationFrame();
    const { result } = renderHook(() => useSmoothStreamText("Original", { reducedMotion: false }));

    act(() => result.current.reset("Replacement"));
    expect(result.current.text).toBe("Replacement");
    expect(result.current.isAnimating).toBe(false);

    act(() => result.current.reset());
    expect(result.current.text).toBe("");
  });

  it("synchronizes replacement text immediately", () => {
    const raf = installAnimationFrame();
    const { result, rerender } = renderHook(
      ({ content }) => useSmoothStreamText(content, { reducedMotion: false }),
      { initialProps: { content: "Hello" } },
    );

    rerender({ content: "Goodbye" });

    expect(result.current.text).toBe("Goodbye");
    expect(result.current.isAnimating).toBe(false);
    expect(raf.request).not.toHaveBeenCalled();
  });

  it("synchronizes appends larger than the configured threshold", () => {
    const raf = installAnimationFrame();
    const { result, rerender } = renderHook(
      ({ content }) => useSmoothStreamText(content, { largeAppendChars: 2, reducedMotion: false }),
      { initialProps: { content: "A" } },
    );

    rerender({ content: "ABCDE" });

    expect(result.current.text).toBe("ABCDE");
    expect(result.current.isAnimating).toBe(false);
    expect(raf.request).not.toHaveBeenCalled();
  });

  it("counts Unicode code points for the large append threshold", () => {
    const raf = installAnimationFrame();
    const { result, rerender } = renderHook(
      ({ content }) => useSmoothStreamText(content, { largeAppendChars: 1, reducedMotion: false }),
      { initialProps: { content: "A" } },
    );

    rerender({ content: "A🙂" });

    expect(result.current.text).toBe("A");
    expect(result.current.isAnimating).toBe(true);
    expect(raf.request).toHaveBeenCalledTimes(1);
  });

  it("synchronizes appends larger than the default 500-character threshold", () => {
    const raf = installAnimationFrame();
    const { result, rerender } = renderHook(
      ({ content }) => useSmoothStreamText(content, { reducedMotion: false }),
      { initialProps: { content: "A" } },
    );

    rerender({ content: `A${"x".repeat(501)}` });

    expect(result.current.text).toBe(`A${"x".repeat(501)}`);
    expect(result.current.isAnimating).toBe(false);
    expect(raf.request).not.toHaveBeenCalled();
  });

  it("synchronizes immediately when streaming stops", () => {
    const raf = installAnimationFrame();
    const { result, rerender } = renderHook(
      ({ content, isStreaming }) =>
        useSmoothStreamText(content, { isStreaming, reducedMotion: false }),
      { initialProps: { content: "A", isStreaming: true } },
    );

    rerender({ content: "ABCDE", isStreaming: true });
    expect(result.current.text).toBe("A");

    rerender({ content: "ABCDE", isStreaming: false });

    expect(result.current.text).toBe("ABCDE");
    expect(result.current.isAnimating).toBe(false);
    expect(raf.cancel).toHaveBeenCalled();
  });

  it("follows the system reduced motion preference by default", () => {
    const raf = installAnimationFrame();
    installMatchMedia(true);
    const { result, rerender } = renderHook(({ content }) => useSmoothStreamText(content), {
      initialProps: { content: "A" },
    });

    rerender({ content: "ABCDE" });

    expect(result.current.text).toBe("ABCDE");
    expect(result.current.isAnimating).toBe(false);
    expect(raf.request).not.toHaveBeenCalled();
  });

  it("lets an explicit reduced motion value override the system preference", () => {
    const raf = installAnimationFrame();
    installMatchMedia(true);
    const { result, rerender } = renderHook(
      ({ content }) => useSmoothStreamText(content, { reducedMotion: false }),
      { initialProps: { content: "A" } },
    );

    rerender({ content: "ABCDE" });

    expect(result.current.text).toBe("A");
    expect(result.current.isAnimating).toBe(true);
    expect(raf.request).toHaveBeenCalledTimes(1);
  });

  it("synchronizes immediately when requestAnimationFrame is unavailable", () => {
    installMatchMedia(false);
    vi.stubGlobal("requestAnimationFrame", undefined);
    const { result, rerender } = renderHook(
      ({ content }) => useSmoothStreamText(content, { reducedMotion: false }),
      { initialProps: { content: "A" } },
    );

    rerender({ content: "ABCDE" });

    expect(result.current.text).toBe("ABCDE");
    expect(result.current.isAnimating).toBe(false);
  });

  it("cancels a scheduled animation frame on unmount", () => {
    const raf = installAnimationFrame();
    const { rerender, unmount } = renderHook(
      ({ content }) => useSmoothStreamText(content, { reducedMotion: false }),
      { initialProps: { content: "A" } },
    );

    rerender({ content: "ABCDE" });
    unmount();

    expect(raf.cancel).toHaveBeenCalledTimes(1);
  });
});

type AnimationFrameHarness = ReturnType<typeof installAnimationFrame>;

function installAnimationFrame() {
  let nextId = 0;
  const callbacks = new Map<number, FrameRequestCallback>();
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
  installMatchMedia(false);

  return {
    cancel,
    pending: () => callbacks.size,
    request,
    step() {
      const pending = [...callbacks.values()];
      callbacks.clear();
      for (const callback of pending) {
        callback(0);
      }
    },
  };
}

function drainAnimationFrames(raf: AnimationFrameHarness): void {
  for (let frame = 0; frame < 100 && raf.pending() > 0; frame += 1) {
    act(() => raf.step());
  }
  expect(raf.pending()).toBe(0);
}

function installMatchMedia(matches: boolean): void {
  const mediaQuery = {
    matches,
    media: "(prefers-reduced-motion: reduce)",
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
  } as unknown as MediaQueryList;

  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => mediaQuery),
  );
}
