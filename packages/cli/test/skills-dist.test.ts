import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const distCli = join(import.meta.dirname, "../dist/cli.js");

// Guards the dist-relative asset lookup (dist/skills/) that source-level tests
// bypass by passing an explicit skillsDirectory. Skips when the package has
// not been built; CI builds before testing so this runs there.
describe.runIf(existsSync(distCli))("built CLI skills assets", () => {
  it("lists bundled skills from dist/skills", () => {
    const result = spawnSync(process.execPath, [distCli, "skills", "list"], {
      encoding: "utf8",
    });

    expect(result.status).toBe(0);

    const skillLines = result.stdout.split("\n").filter((line) => line.startsWith("skills/"));

    expect(skillLines).toContain("skills/anvia-agent");
    expect(skillLines.length).toBeGreaterThan(0);
    expect(result.stdout).toContain("skills available");
  });
});
