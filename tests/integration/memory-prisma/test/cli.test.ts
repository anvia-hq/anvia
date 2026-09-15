import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, it } from "vitest";

const builtCli = fileURLToPath(
  new URL("../../../../packages/memory-prisma/dist/cli.js", import.meta.url),
);

it.each(["7", "8"])(
  "runs the published Prisma %s CLI through a package-manager symlink",
  (version) => {
    const directory = mkdtempSync(join(tmpdir(), "anvia cli #"));
    try {
      const target = join(directory, "cli.mjs");
      const bin = join(directory, "anvia-memory-prisma");
      cpSync(builtCli, target);
      symlinkSync(target, bin, "file");
      const output = version === "8" ? "contract.prisma" : "schema.prisma";
      const args = [
        "init",
        "--prisma-version",
        version,
        version === "8" ? "--contract" : "--schema",
        output,
      ];
      if (version === "7") {
        // Prisma 7 writes a separate model file beside an existing schema.
        writeFileSync(join(directory, output), 'datasource db {\n  provider = "postgresql"\n}\n');
      }
      const invoke = (extra: string[]) =>
        spawnSync(process.execPath, [bin, ...args, ...extra], {
          cwd: directory,
          encoding: "utf8",
          timeout: 10_000,
        });
      const preview = invoke([]);
      expect(preview.status).toBe(0);
      expect(preview.stdout).toContain("AgentMemorySession");
      const generated = join(directory, version === "8" ? output : "models/anvia-memory.prisma");
      expect(existsSync(generated)).toBe(false);
      const write = invoke(["--write"]);
      expect(write.status).toBe(0);
      expect(readFileSync(generated, "utf8")).toContain("model AgentMemorySession");
      const invalid = invoke(["--unknown"]);
      expect(invalid.status).toBe(1);
      expect(invalid.stderr).toContain("Unknown option");
      const imported = spawnSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `process.argv[1] = 'missing-entry.js'; await import(${JSON.stringify(pathToFileURL(target).href)});`,
        ],
        { cwd: directory, encoding: "utf8", timeout: 10_000 },
      );
      expect(imported.status).toBe(0);
      expect(imported.stdout).toBe("");
      expect(imported.stderr).toBe("");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
