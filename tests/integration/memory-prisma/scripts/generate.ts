import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { prismaMemorySchema } from "../../../../packages/memory-prisma/src/schema.js";
import { prisma8SchemaBlock } from "../../../../packages/memory-prisma/src/schema-v8.js";

mkdirSync("generated/v7", { recursive: true });
mkdirSync("generated/v8", { recursive: true });
writeFileSync("generated/v8/contract.prisma", prisma8SchemaBlock());
writeFileSync(
  "generated/v7/schema.prisma",
  `generator client {
  provider = "prisma-client"
  output = "./client"
}
datasource db {
  provider = "postgresql"
}
${prismaMemorySchema}`,
);
execFileSync(
  "node",
  ["node_modules/prisma7/build/index.js", "generate", "--config", "prisma7.config.ts"],
  { stdio: "inherit" },
);
execFileSync("pnpm", ["exec", "prisma", "contract", "emit"], { stdio: "inherit" });
mkdirSync("generated/custom", { recursive: true });
writeFileSync(
  "generated/custom/contract.prisma",
  prisma8SchemaBlock()
    .replace(/\bAgentMemorySession\b(?!")/g, "CustomSession")
    .replace(/\bAgentMemoryMessage\b(?!")/g, "CustomMessage")
    .replace(/\bAgentMemoryError\b(?!")/g, "CustomError"),
);
execFileSync("pnpm", ["exec", "prisma", "contract", "emit"], {
  stdio: "inherit",
  env: { ...process.env, ANVIA_PRISMA_TEST_CONTRACT_DIR: "generated/custom" },
});
