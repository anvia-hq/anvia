// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import {
  formatWorkingDuration,
  WorkingDuration,
} from "../src/ui/app/modules/playground/working-duration";

describe("WorkingDuration", () => {
  it("formats nonnegative elapsed time as minutes and seconds", () => {
    expect(formatWorkingDuration(-1)).toBe("Finished - 0s");
    expect(formatWorkingDuration(Number.NaN)).toBe("Finished - 0s");
    expect(formatWorkingDuration(999)).toBe("Finished - 0s");
    expect(formatWorkingDuration(61_999)).toBe("Finished - 1m 1s");
    expect(formatWorkingDuration(3_661_000)).toBe("Finished - 61m 1s");
  });

  it("renders only a completed duration", () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    act(() => root.render(<WorkingDuration durationMs={65_000} />));

    expect(container.textContent).toContain("Finished - 1m 5s");
    expect(container.textContent).not.toContain("Working");
    expect(container.querySelector(".animate-spin")).toBeNull();

    act(() => root.unmount());
  });
});
