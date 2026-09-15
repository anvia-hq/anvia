import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("imports both published entrypoints with neither Prisma runtime installed", () => {
  const directory = mkdtempSync(join(tmpdir(), "anvia-prisma-imports-"));
  const packages = fileURLToPath(new URL("../../../../packages/", import.meta.url));
  try {
    const scope = join(directory, "node_modules/@anvia");
    const target = join(scope, "memory-prisma");
    mkdirSync(target, { recursive: true });
    cpSync(join(packages, "memory-prisma/package.json"), join(target, "package.json"));
    cpSync(join(packages, "memory-prisma/dist"), join(target, "dist"), { recursive: true });
    symlinkSync(join(packages, "core"), join(scope, "core"), "dir");
    const output = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
      import assert from "node:assert/strict";
      import { createRequire } from "node:module";
      const require = createRequire(process.cwd() + "/probe.mjs");
      for (const peer of ["@prisma/client", "@prisma/orm-postgres/package.json"]) {
        assert.throws(() => require.resolve(peer), { code: "MODULE_NOT_FOUND" });
      }
      for (const entry of ["@anvia/memory-prisma", "@anvia/memory-prisma/v8"]) {
        const module = await import(entry);
        assert.equal(typeof module.PrismaMemoryStore, "function");
      }
      console.log("isolated imports passed");
    `,
      ],
      { cwd: directory, encoding: "utf8", env: { ...process.env, NODE_PATH: "" } },
    );
    expect(output).toContain("isolated imports passed");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
