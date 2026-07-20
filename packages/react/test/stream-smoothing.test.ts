import { describe, expect, it } from "vitest";

import {
  advanceStreamSmoothing,
  createStreamSmoothingState,
  flushStreamSmoothing,
  getBufferedPlaybackTarget,
  getStreamSmoothingSnapshot,
  type SmoothStreamItemAdapter,
  streamSmoothingConfig,
  updateStreamSmoothingTarget,
} from "../src/stream-smoothing";

type Item =
  | { id: string; kind: "text"; text: string }
  | { id: string; kind: "tool"; status: string };

const adapter: SmoothStreamItemAdapter<Item> = {
  getKey: (item) => item.id,
  getText: (item) => (item.kind === "text" ? item.text : undefined),
  withText: (item, text) => (item.kind === "text" ? { ...item, text } : item),
};

describe("stream smoothing state", () => {
  it("interpolates the delayed source timeline", () => {
    const samples = [
      { atMs: 0, totalChars: 0 },
      { atMs: 100, totalChars: 20 },
    ];

    expect(getBufferedPlaybackTarget(samples, 225)).toBe(0);
    expect(getBufferedPlaybackTarget(samples, 275)).toBe(10);
    expect(getBufferedPlaybackTarget(samples, 325)).toBe(20);
  });

  it("bounds the animated backlog without losing target content", () => {
    const target: Item[] = [{ id: "text", kind: "text", text: "x".repeat(2_500) }];
    const initial = createStreamSmoothingState<Item>([], { isStreaming: true, nowMs: 0 }, adapter);
    const updated = updateStreamSmoothingTarget(
      initial,
      target,
      { isStreaming: true, nowMs: 10 },
      adapter,
    );
    const displayedText =
      updated.displayedItems[0]?.kind === "text" ? updated.displayedItems[0].text : "";

    expect(
      target[0]?.kind === "text" ? target[0].text.length - displayedText.length : 0,
    ).toBeLessThanOrEqual(streamSmoothingConfig.maxPendingChars);
    expect(flushStreamSmoothing(updated, 20, adapter).displayedItems).toBe(updated.targetItems);
  });

  it("reconciles replacements at a grapheme-safe common prefix", () => {
    const initialTarget: Item[] = [{ id: "text", kind: "text", text: "Hello 👨‍👩‍👧‍👦 world" }];
    let state = createStreamSmoothingState(initialTarget, { isStreaming: true, nowMs: 0 }, adapter);
    const replacement: Item[] = [{ id: "text", kind: "text", text: "Hello 👨‍👩‍👧‍👦 there" }];
    state = updateStreamSmoothingTarget(
      state,
      replacement,
      { isStreaming: true, nowMs: 100 },
      adapter,
    );
    const displayed = state.displayedItems[0];

    expect(displayed?.kind === "text" ? displayed.text : "").toBe("Hello 👨‍👩‍👧‍👦 ");
  });

  it("produces comparable elapsed-time playback across frame rates", () => {
    const target: Item[] = [{ id: "text", kind: "text", text: "x".repeat(300) }];
    const at60 = advanceForFrameRate(target, 60);
    const at120 = advanceForFrameRate(target, 120);

    expect(Math.abs(at60 - at120)).toBeLessThanOrEqual(6);
  });

  it("reports draining until target and display are identical", () => {
    const target: Item[] = [{ id: "text", kind: "text", text: "Completion tail" }];
    let state = createStreamSmoothingState<Item>([], { isStreaming: true, nowMs: 0 }, adapter);
    state = updateStreamSmoothingTarget(state, target, { isStreaming: true, nowMs: 0 }, adapter);
    state = updateStreamSmoothingTarget(state, target, { isStreaming: false, nowMs: 100 }, adapter);
    expect(getStreamSmoothingSnapshot(state, adapter).isDraining).toBe(true);

    for (let now = 117; now <= 900; now += 17) {
      state = advanceStreamSmoothing(state, now, adapter);
    }
    const snapshot = getStreamSmoothingSnapshot(state, adapter);
    expect(snapshot.items).toBe(state.targetItems);
    expect(snapshot.isDraining).toBe(false);
  });

  it("preserves an active drain across repeated non-streaming target updates", () => {
    const target: Item[] = [{ id: "text", kind: "text", text: "Completion tail" }];
    let state = createStreamSmoothingState<Item>([], { isStreaming: true, nowMs: 0 }, adapter);
    state = updateStreamSmoothingTarget(state, target, { isStreaming: true, nowMs: 0 }, adapter);
    state = updateStreamSmoothingTarget(state, target, { isStreaming: false, nowMs: 100 }, adapter);
    const displayedBeforeRerender = state.displayedItems;

    state = updateStreamSmoothingTarget(
      state,
      [...target],
      { isStreaming: false, nowMs: 120 },
      adapter,
    );

    expect(state.displayedItems).toEqual(displayedBeforeRerender);
    expect(state.displayedItems).not.toBe(state.targetItems);
    expect(getStreamSmoothingSnapshot(state, adapter).isDraining).toBe(true);
  });
});

function advanceForFrameRate(target: Item[], framesPerSecond: number): number {
  let state = createStreamSmoothingState<Item>([], { isStreaming: true, nowMs: 0 }, adapter);
  state = updateStreamSmoothingTarget(state, target, { isStreaming: true, nowMs: 0 }, adapter);
  const frameDuration = 1_000 / framesPerSecond;
  for (let now = frameDuration; now <= 500; now += frameDuration) {
    if (now - state.lastAdvanceAtMs + 0.5 < 1_000 / streamSmoothingConfig.maxCommitFps) {
      continue;
    }
    state = advanceStreamSmoothing(state, now, adapter);
  }
  const first = state.displayedItems[0];
  return first?.kind === "text" ? first.text.length : 0;
}
