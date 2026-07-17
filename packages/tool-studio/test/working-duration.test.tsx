// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatWorkingDuration,
  WorkingDuration,
} from "../src/ui/app/modules/playground/working-duration";

describe("WorkingDuration", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-17T00:00:00.000Z"));
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it("formats nonnegative elapsed time as minutes and seconds", () => {
    expect(formatWorkingDuration(-1)).toBe("Working - 0s");
    expect(formatWorkingDuration(Number.NaN)).toBe("Working - 0s");
    expect(formatWorkingDuration(999)).toBe("Working - 0s");
    expect(formatWorkingDuration(61_999)).toBe("Working - 1m 1s");
    expect(formatWorkingDuration(3_661_000)).toBe("Working - 61m 1s");
    expect(formatWorkingDuration(999, "finished")).toBe("Finished - 0s");
    expect(formatWorkingDuration(65_000, "finished")).toBe("Finished - 1m 5s");
  });

  it("ticks while active and freezes at the supplied duration", () => {
    const startedAt = Date.now();
    act(() => root.render(<WorkingDuration startedAt={startedAt} />));
    expect(container.textContent).toBe("Working - 0s");
    expect(container.querySelector(".animate-spin")).not.toBeNull();

    act(() => vi.advanceTimersByTime(61_000));
    expect(container.textContent).toBe("Working - 1m 1s");

    act(() => root.render(<WorkingDuration durationMs={65_000} />));
    expect(container.textContent).toBe("Finished - 1m 5s");
    expect(container.querySelector(".animate-spin")).toBeNull();

    act(() => vi.advanceTimersByTime(10_000));
    expect(container.textContent).toBe("Finished - 1m 5s");
  });
});
