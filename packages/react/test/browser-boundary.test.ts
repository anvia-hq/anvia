import { resolve } from "node:path";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";

describe("browser package boundary", () => {
  it("bundles React and Client without loading the Agent runtime or Node infrastructure", async () => {
    const result = await build({
      bundle: true,
      entryPoints: [resolve("src/index.ts")],
      external: ["react", "react/*", "react-dom", "react-dom/*"],
      format: "esm",
      metafile: true,
      platform: "browser",
      tsconfig: resolve("tsconfig.json"),
      write: false,
    });

    const inputs = Object.keys(result.metafile.inputs).map((input) => input.replaceAll("\\", "/"));
    expect(inputs.some((input) => input.endsWith("core/src/agent/interactions/index.ts"))).toBe(
      true,
    );
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

  it("tree-shakes heavy UI dependencies when importing hooks only", async () => {
    const result = await build({
      bundle: true,
      stdin: {
        contents: 'export { useChat, useCompletion } from "./src/index.ts";',
        resolveDir: resolve("."),
        loader: "ts",
      },
      external: ["react", "react/*", "react-dom", "react-dom/*"],
      format: "esm",
      metafile: true,
      platform: "browser",
      treeShaking: true,
      tsconfig: resolve("tsconfig.json"),
      write: false,
    });

    const output = Object.values(result.metafile.outputs)[0];
    const inputs = Object.entries(output?.inputs ?? {})
      .filter(([, meta]) => meta.bytesInOutput > 0)
      .map(([input]) => input.replaceAll("\\", "/"));
    expect(inputs.some((input) => input.endsWith("src/use-chat.ts"))).toBe(true);
    expect(inputs.some((input) => input.endsWith("src/use-completion.ts"))).toBe(true);
    expect(
      inputs.filter(
        (input) =>
          input.includes("@tiptap/") ||
          input.includes("prosemirror") ||
          input.includes("react-markdown") ||
          input.includes("remark-gfm") ||
          input.includes("/marked/") ||
          input.includes("@radix-ui/"),
      ),
    ).toEqual([]);
  });
});
