import { cpSync, mkdirSync, readdirSync, rmSync } from "node:fs";

const source = new URL("../../../skills/", import.meta.url);
const destination = new URL("../dist/skills/", import.meta.url);

rmSync(destination, { force: true, recursive: true });
mkdirSync(destination, { recursive: true });

// Copy each skill directory (SKILL.md + references/ + scripts/). The folder-level
// README.md is repo documentation and intentionally stays out of the bundle.
// cpSync preserves file modes, so executable skill scripts stay executable.
for (const entry of readdirSync(source, { withFileTypes: true })) {
  if (entry.isDirectory()) {
    cpSync(new URL(`${entry.name}/`, source), new URL(`${entry.name}/`, destination), {
      recursive: true,
    });
  }
}
