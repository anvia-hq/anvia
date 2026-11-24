import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const source = new URL("../registry/", import.meta.url);
const destination = new URL("../dist/registry/", import.meta.url);

rmSync(destination, { force: true, recursive: true });
mkdirSync(destination, { recursive: true });

for (const filename of readdirSync(source).filter((entry) => entry.endsWith(".tsx"))) {
  cpSync(new URL(filename, source), new URL(filename, destination));
}

const reactPkg = JSON.parse(
  readFileSync(new URL("../../react/package.json", import.meta.url), "utf8"),
);
writeFileSync(
  new URL("react.json", destination),
  `${JSON.stringify({ version: reactPkg.version })}\n`,
);
