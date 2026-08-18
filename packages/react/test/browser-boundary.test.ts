import { resolve } from "node:path";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";

describe("browser package boundary", () => {
  it("bundles React and Client without loading the Agent runtime or Node infrastructure", async () => {
    const result = await build({
      bundle: true,
      entryPoints: [resolve("src/index.ts")],
      external: ["react", "react/*"],
      format: "esm",
      metafile: true,
      platform: "browser",
      tsconfig: resolve("tsconfig.json"),
      write: false,
    });

    const inputs = Object.keys(result.metafile.inputs).map((input) => input.replaceAll("\\", "/"));
    expect(inputs.some((input) => input.endsWith("core/src/agent/interactions.ts"))).toBe(true);
    expect(
      inputs.filter(
        (input) =>
          input.includes("node_modules/.pnpm/undici@") ||
          input.includes("node_modules/@modelcontextprotocol/") ||
          input.includes("core/src/agent/agent.ts") ||
          input.includes("core/src/internal/agent-runtime/") ||
          input.includes("core/src/mcp/"),
      ),
    ).toEqual([]);
  });
});
