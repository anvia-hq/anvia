import { cpSync, mkdirSync, readdirSync, rmSync } from "node:fs";

const source = new URL("../../../skills/", import.meta.url);
const destination = new URL("../dist/skills/", import.meta.url);

rmSync(destination, { force: true, recursive: true });
mkdirSync(destination, { recursive: true });

for (const entry of readdirSync(source, { withFileTypes: true })) {
  if (entry.isDirectory()) {
    cpSync(new URL(`${entry.name}/`, source), new URL(`${entry.name}/`, destination), {
      recursive: true,
    });
  }
}
