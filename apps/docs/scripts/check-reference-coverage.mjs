import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, "../../..");

const packageDocs = new Map([
  ["@anvia/core", "apps/docs/content/docs/reference/core"],
  ["@anvia/openai", "apps/docs/content/docs/reference/providers/openai.mdx"],
  ["@anvia/gemini", "apps/docs/content/docs/reference/providers/gemini.mdx"],
  ["@anvia/anthropic", "apps/docs/content/docs/reference/providers/anthropic.mdx"],
  ["@anvia/mistral", "apps/docs/content/docs/reference/providers/mistral.mdx"],
  ["@anvia/fastembed", "apps/docs/content/docs/reference/integrations/fastembed.mdx"],
  ["@anvia/transformers", "apps/docs/content/docs/reference/integrations/transformers.mdx"],
  ["@anvia/chroma", "apps/docs/content/docs/reference/integrations/chroma.mdx"],
  ["@anvia/pgvector", "apps/docs/content/docs/reference/integrations/pgvector.mdx"],
  ["@anvia/qdrant", "apps/docs/content/docs/reference/integrations/qdrant.mdx"],
  ["@anvia/langfuse", "apps/docs/content/docs/reference/integrations/langfuse.mdx"],
  ["@anvia/otel", "apps/docs/content/docs/reference/integrations/otel.mdx"],
  ["@anvia/studio", "apps/docs/content/docs/reference/studio"],
]);

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function discoverPackages() {
  const packageDirs = [];
  for (const workspaceDir of ["packages"]) {
    const root = join(repoRoot, workspaceDir);
    for (const name of readdirSync(root)) {
      const firstLevel = join(root, name);
      if (!statSync(firstLevel).isDirectory()) continue;

      const firstLevelPackage = join(firstLevel, "package.json");
      if (existsSync(firstLevelPackage)) packageDirs.push(firstLevel);

      for (const childName of readdirSync(firstLevel)) {
        const secondLevel = join(firstLevel, childName);
        if (statSync(secondLevel).isDirectory() && existsSync(join(secondLevel, "package.json"))) {
          packageDirs.push(secondLevel);
        }
      }
    }
  }

  return packageDirs
    .map((dir) => ({ dir, pkg: JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) }))
    .filter(({ pkg }) => typeof pkg.name === "string" && pkg.name.startsWith("@anvia/"))
    .sort((a, b) => a.pkg.name.localeCompare(b.pkg.name));
}

function getExportsMap(pkg) {
  if (pkg.exports === undefined) {
    return [[".", { import: pkg.main, types: pkg.types }]];
  }

  return Object.entries(pkg.exports);
}

function getImportTarget(target) {
  if (typeof target === "string") return target;
  if (target && typeof target === "object") return target.import ?? target.default ?? target.types;
  return undefined;
}

function sourcePathForPackageExport(packageDir, target) {
  const importTarget = getImportTarget(target);
  if (typeof importTarget !== "string") return undefined;

  return join(packageDir, importTarget.replace(/^\.\/dist\//, "src/").replace(/\.js$/, ".ts"));
}

function getPublicExports(file) {
  const program = ts.createProgram([file], {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    skipLibCheck: true,
  });
  const checker = program.getTypeChecker();
  const sourceFile = program.getSourceFile(file);
  const moduleSymbol = checker.getSymbolAtLocation(sourceFile);

  if (!moduleSymbol) return [];

  return checker.getExportsOfModule(moduleSymbol).map((symbol) => symbol.getName());
}

function readDocsText(docsPath) {
  const absolutePath = join(repoRoot, docsPath);
  if (!existsSync(absolutePath)) {
    throw new Error(`Reference docs path does not exist: ${docsPath}`);
  }

  if (statSync(absolutePath).isDirectory()) {
    return walk(absolutePath)
      .filter((file) => file.endsWith(".mdx"))
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");
  }

  return readFileSync(absolutePath, "utf8");
}

let totalMissingEntrypoints = 0;
let totalMissingSymbols = 0;
let totalEntrypoints = 0;
let totalSymbols = 0;
const lines = [];

for (const { dir, pkg } of discoverPackages()) {
  const docsPath = packageDocs.get(pkg.name);
  if (!docsPath) {
    throw new Error(`No reference docs mapping configured for ${pkg.name}`);
  }

  const docsText = readDocsText(docsPath);
  const exportEntries = getExportsMap(pkg);
  const publicExports = new Set();
  const entrypoints = [];

  for (const [subpath, target] of exportEntries) {
    const importPath = subpath === "." ? pkg.name : `${pkg.name}${subpath.slice(1)}`;
    entrypoints.push(importPath);

    const sourcePath = sourcePathForPackageExport(dir, target);
    if (sourcePath && existsSync(sourcePath)) {
      for (const name of getPublicExports(sourcePath)) {
        publicExports.add(name);
      }
    }
  }

  const missingEntrypoints = entrypoints.filter((name) => !docsText.includes(name));
  const missingSymbols = [...publicExports].sort().filter((name) => !docsText.includes(name));

  totalEntrypoints += entrypoints.length;
  totalSymbols += publicExports.size;
  totalMissingEntrypoints += missingEntrypoints.length;
  totalMissingSymbols += missingSymbols.length;

  lines.push(
    `${pkg.name}: ${entrypoints.length} entrypoints, ${publicExports.size} exports, ${missingEntrypoints.length} undocumented entrypoints, ${missingSymbols.length} undocumented exports`,
  );

  if (missingEntrypoints.length > 0) {
    lines.push(`  missing entrypoints: ${missingEntrypoints.join(", ")}`);
  }

  if (missingSymbols.length > 0) {
    lines.push(`  missing exports: ${missingSymbols.join(", ")}`);
  }
}

for (const line of lines) console.log(line);
console.log(
  `TOTAL_ENTRYPOINTS=${totalEntrypoints} TOTAL_EXPORTS=${totalSymbols} TOTAL_MISSING_ENTRYPOINTS=${totalMissingEntrypoints} TOTAL_MISSING_EXPORTS=${totalMissingSymbols}`,
);

if (totalMissingEntrypoints > 0 || totalMissingSymbols > 0) {
  console.error(
    `Reference coverage failed from ${relative(process.cwd(), fileURLToPath(import.meta.url))}. Document missing public entrypoints or exports before merging.`,
  );
  process.exit(1);
}
