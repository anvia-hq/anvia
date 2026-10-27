import { describe, expect, it } from "vitest";
import { estimateMemoryTokens } from "../src/memory";

describe("estimateMemoryTokens", () => {
  it("bounds inline base64 image data", () => {
    const tokens = estimateMemoryTokens([
      {
        role: "user",
        content: [{ type: "image", image: { type: "data", data: "A".repeat(1_000_000) } }],
      },
    ]);
    expect(tokens).toBeGreaterThan(0);
    expect(tokens).toBeLessThan(5_000);
  });

  it("bounds inline file data", () => {
    const tokens = estimateMemoryTokens([
      {
        role: "user",
        content: [
          { type: "file", data: { type: "data", data: "A".repeat(1_000_000) }, mediaType: "x/y" },
        ],
      },
    ]);
    expect(tokens).toBeLessThan(5_000);
  });

  it("still counts text file data in full", () => {
    const tokens = estimateMemoryTokens([
      {
        role: "user",
        content: [
          {
            type: "file",
            data: { type: "text", text: "a".repeat(40_000) },
            mediaType: "text/plain",
          },
        ],
      },
    ]);
    expect(tokens).toBeGreaterThan(10_000);
  });
});
