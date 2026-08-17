import { describe, expect, it } from "vitest";

describe("@anvia/browser public exports", () => {
  it("exports only the intentional runtime values", async () => {
    const exports = await import("../src/index");
    expect(Object.keys(exports).sort()).toEqual([
      "BrowserError",
      "DockerBrowserClient",
      "createBrowserTools",
    ]);
  });
});
