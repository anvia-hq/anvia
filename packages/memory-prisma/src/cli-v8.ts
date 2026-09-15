import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { prismaMemoryModelNames } from "./schema.js";
import { prisma8EndMarker, prisma8SchemaBlock, prisma8StartMarker } from "./schema-v8.js";

export function initPrisma8Memory(
  options: {
    contract?: string | undefined;
    appendToContract: boolean;
    write: boolean;
    force: boolean;
  },
  cwd: string,
  io: { log(message: string): void; warn(message: string): void },
): void {
  if (options.contract === undefined || !options.contract.endsWith(".prisma")) {
    throw new Error("Prisma 8 init requires --contract <path.prisma> (a single PSL contract).");
  }
  const path = resolve(cwd, options.contract);
  const displayPath = relative(cwd, path);
  const exists = existsSync(path);
  if (exists && !options.appendToContract) {
    throw new Error(`${displayPath} already exists. Use --append-to-contract to modify it.`);
  }
  if (!exists && options.appendToContract) {
    throw new Error(
      `Prisma 8 contract not found at ${displayPath}. Omit --append-to-contract to create it.`,
    );
  }

  const current = exists ? readFileSync(path, "utf8") : "";
  const start = current.indexOf(prisma8StartMarker);
  const end = current.indexOf(prisma8EndMarker);
  const hasBlock = start !== -1 || end !== -1;
  if (
    hasBlock &&
    (start === -1 ||
      end < start ||
      current.indexOf(prisma8StartMarker, start + 1) !== -1 ||
      current.indexOf(prisma8EndMarker, end + 1) !== -1)
  ) {
    throw new Error("Found incomplete or duplicate Anvia memory Prisma 8 markers.");
  }
  if (hasBlock && !options.force) {
    throw new Error("Anvia memory Prisma 8 block already exists. Use --force to replace it.");
  }
  const prefix = hasBlock ? current.slice(0, start) : current;
  const suffix = hasBlock ? current.slice(end + prisma8EndMarker.length) : "";
  const outside = `${prefix}\n${suffix}`.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
  const conflicts = prismaMemoryModelNames.filter((name) =>
    new RegExp(`\\bmodel\\s+${name}\\b`).test(outside),
  );
  if (conflicts.length > 0)
    throw new Error(`Existing Prisma models conflict: ${conflicts.join(", ")}`);
  const block = prisma8SchemaBlock();
  const next = hasBlock
    ? `${prefix}${block.trimEnd()}${suffix}`
    : `${current}${current.length > 0 ? "\n\n" : ""}${block}`;

  if (exists)
    io.warn(
      "Warning: appending modifies your existing Prisma 8 contract. Review before migrating.",
    );
  if (options.write) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, next);
    io.log(`${exists ? "Updated" : "Created"} ${displayPath}`);
  } else {
    io.log(`Would ${exists ? "update" : "create"} ${displayPath}`);
    io.log(block);
  }
  io.log("\nConfigure prisma.config.ts with:");
  io.log('  import { definePrismaConfig } from "prisma/config";');
  io.log('  import { defineConfig } from "@prisma/orm-postgres/config";');
  io.log(
    `  export default definePrismaConfig({ orm: defineConfig({ contract: ${JSON.stringify(displayPath)}, output: ${JSON.stringify(relative(cwd, dirname(path)) || ".")}, db: { connection: process.env.DATABASE_URL } }) });`,
  );
  io.log("\nNext (using the locally installed Prisma 8 CLI):");
  io.log("  pnpm exec prisma contract emit");
  io.log("For a new database, review and apply migrations with: pnpm exec prisma db update");
  io.log(
    "For existing Prisma 7 tables, infer and review their contract first; keep Prisma 7 migration ownership until explicitly transferring it. See the package README.",
  );
}
