import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";

const HEAVY_UI_PATTERNS = [
  "@tiptap/",
  "prosemirror",
  "react-markdown",
  "remark-gfm",
  "/marked/",
  "@radix-ui/",
] as const;

async function bundledActiveInputs(contents: string) {
  const result = await build({
    bundle: true,
    stdin: {
      contents,
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
  return Object.entries(output?.inputs ?? {})
    .filter(([, meta]) => meta.bytesInOutput > 0)
    .map(([input]) => input.replaceAll("\\", "/"));
}

function findHeavyUiInputs(inputs: readonly string[]) {
  return inputs.filter((input) => HEAVY_UI_PATTERNS.some((pattern) => input.includes(pattern)));
}

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
          input.includes("core/src/mcp/") ||
          input.includes("src/sandbox-terminal") ||
          input.includes("src/sandbox-desktop") ||
          input.includes("@xterm/") ||
          input.includes("@novnc/"),
      ),
    ).toEqual([]);
  });

  it("tree-shakes heavy UI dependencies when importing hooks from src", async () => {
    const rootInputs = await bundledActiveInputs(
      'export { initialMessagesFromMemory, useChat, useCompletion, useDurableChat, useSmoothStreamItems, useSmoothStreamText } from "./src/index.ts";',
    );
    expect(rootInputs.some((input) => input.endsWith("src/use-chat.ts"))).toBe(true);
    expect(rootInputs.some((input) => input.endsWith("src/use-completion.ts"))).toBe(true);
    expect(rootInputs.some((input) => input.endsWith("src/use-durable-chat.ts"))).toBe(true);
    expect(rootInputs.some((input) => input.endsWith("src/use-smooth-stream-text.ts"))).toBe(true);
    expect(rootInputs.some((input) => input.endsWith("src/use-smooth-stream-items.ts"))).toBe(true);
    expect(findHeavyUiInputs(rootInputs)).toEqual([]);

    const graphInputs = await bundledActiveInputs(
      'export { useGraphExplorer } from "./src/graph-explorer/index.ts";',
    );
    expect(
      graphInputs.some((input) => input.endsWith("src/graph-explorer/use-graph-explorer.ts")),
    ).toBe(true);
    expect(findHeavyUiInputs(graphInputs)).toEqual([]);
  });

  describe.runIf(existsSync(resolve("dist/index.js")))("built dist artifacts", () => {
    it("tree-shakes heavy UI dependencies when importing hooks from dist", async () => {
      const rootInputs = await bundledActiveInputs(
        'export { initialMessagesFromMemory, useChat, useCompletion, useDurableChat, useSmoothStreamItems, useSmoothStreamText } from "./dist/index.js";',
      );
      expect(rootInputs.some((input) => input.endsWith("dist/use-chat.js"))).toBe(true);
      expect(rootInputs.some((input) => input.endsWith("dist/use-completion.js"))).toBe(true);
      expect(rootInputs.some((input) => input.endsWith("dist/use-durable-chat.js"))).toBe(true);
      expect(rootInputs.some((input) => input.endsWith("dist/use-smooth-stream-text.js"))).toBe(
        true,
      );
      expect(rootInputs.some((input) => input.endsWith("dist/use-smooth-stream-items.js"))).toBe(
        true,
      );
      expect(findHeavyUiInputs(rootInputs)).toEqual([]);

      const graphInputs = await bundledActiveInputs(
        'export { useGraphExplorer } from "./dist/graph-explorer/index.js";',
      );
      expect(
        graphInputs.some((input) => input.endsWith("dist/graph-explorer/use-graph-explorer.js")),
      ).toBe(true);
      expect(findHeavyUiInputs(graphInputs)).toEqual([]);
    });
  });
});
