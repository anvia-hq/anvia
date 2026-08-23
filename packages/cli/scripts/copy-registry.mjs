import { cpSync, mkdirSync, readdirSync, rmSync } from "node:fs";

const source = new URL("../registry/", import.meta.url);
const destination = new URL("../dist/registry/", import.meta.url);

rmSync(destination, { force: true, recursive: true });
mkdirSync(destination, { recursive: true });

for (const filename of readdirSync(source).filter((entry) => entry.endsWith(".tsx"))) {
  cpSync(new URL(filename, source), new URL(filename, destination));
}
