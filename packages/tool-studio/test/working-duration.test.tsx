import { describe, expect, it } from "vitest";
import { formatWorkingDuration } from "../src/ui/app/modules/playground/working-duration";

describe("WorkingDuration", () => {
  it("formats nonnegative elapsed time as minutes and seconds", () => {
    expect(formatWorkingDuration(-1)).toBe("Finished - 0s");
    expect(formatWorkingDuration(Number.NaN)).toBe("Finished - 0s");
    expect(formatWorkingDuration(999)).toBe("Finished - 0s");
    expect(formatWorkingDuration(61_999)).toBe("Finished - 1m 1s");
    expect(formatWorkingDuration(3_661_000)).toBe("Finished - 61m 1s");
  });
});
