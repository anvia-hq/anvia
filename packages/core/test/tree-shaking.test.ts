import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { build } from "tsdown";
import { expect, it } from "vitest";
import config, { sourceEntries } from "../tsdown.config";

const execFileAsync = promisify(execFile);
const packageDir = fileURLToPath(new URL("../", import.meta.url));
// The first config builds the unbundled JavaScript; the second only emits declarations.
const [sourceConfig] = config;
if (sourceConfig === undefined) throw new Error("Expected a source tsdown config.");

it("tree-shakes createTool from root and tool entrypoints without changing execution", async () => {
  const temporaryDir = await mkdtemp(join(packageDir, ".tree-shaking-"));
  try {
    const outDir = join(temporaryDir, "dist");
    await build({
      ...sourceConfig,
      // Glob expansion requires forward slashes; Windows joins produce backslashes.
      entry: sourceEntries.map((entry) => join(packageDir, entry).replaceAll("\\", "/")),
      outDir,
      dts: false,
      clean: false,
      config: false,
      logLevel: "silent",
    });

    for (const [name, entry] of [
      ["root", "index.js"],
      ["tool", "tool/index.js"],
    ] as const) {
      const consumer = join(temporaryDir, `${name}.ts`);
      await writeFile(
        consumer,
        `export { createTool } from ${JSON.stringify(join(outDir, entry))};`,
      );
      const consumerDir = join(temporaryDir, name);
      await build({
        entry: [consumer.replaceAll("\\", "/")],
        outDir: consumerDir,
        format: ["esm"],
        platform: "node",
        minify: true,
        noExternal: [/.*/],
        fixedExtension: false,
        dts: false,
        clean: false,
        config: false,
        logLevel: "silent",
      });
      const bundle = join(consumerDir, `${name}.js`);
      // Include dependencies: this ceiling catches both namespace retention and
      // unrelated schema initialization leaking across generated module boundaries.
      expect((await readFile(bundle)).byteLength).toBeLessThan(30_000);
      // Windows requires file:// URLs for ESM imports of absolute paths.
      const bundleUrl = pathToFileURL(bundle).href;
      const { stdout } = await execFileAsync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `import { createTool } from ${JSON.stringify(bundleUrl)};
import { z } from "zod";
const tool = createTool({
  name: "double", description: "Double a number",
  inputSchema: z.object({ value: z.number() }), outputSchema: z.number(),
  execute: ({ value }) => value * 2,
});
if ((await tool.call({ value: 3 })) !== 6) throw new Error("Incorrect result");
let rejected = false;
try { await tool.call({ value: "invalid" }); } catch { rejected = true; }
if (!rejected) throw new Error("Input validation was lost");
console.log(JSON.stringify(tool.definition()));`,
        ],
        { cwd: dirname(consumer) },
      );
      expect(JSON.parse(stdout)).toEqual({
        name: "double",
        description: "Double a number",
        parameters: {
          type: "object",
          properties: { value: { type: "number" } },
          required: ["value"],
          additionalProperties: false,
        },
      });
    }
  } finally {
    await rm(temporaryDir, { recursive: true, force: true });
  }
}, 30_000);
