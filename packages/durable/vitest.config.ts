import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const shimFor = (name: string) =>
  fileURLToPath(new URL(`./test/helpers/${name}-as-sqlite.ts`, import.meta.url));

/** The Drizzle and Prisma adapters share the SQL layer, so a core subset is enough for them. */
const adapterScenarios = [
  "test/runtime.test.ts",
  "test/tasks.test.ts",
  "test/goals.test.ts",
  "test/graph.test.ts",
  "test/scheduling.test.ts",
  "test/steering.test.ts",
  "test/blob-references.test.ts",
  "test/blob-outcomes.test.ts",
  "test/compaction.test.ts",
  "test/execution.test.ts",
];

/** Test files that inspect SQLite files, backups, child processes or SQLite internals directly. */
const sqliteOnly = [
  "test/postgres-store.test.ts",
  "test/drizzle-store.test.ts",
  "test/prisma-store.test.ts",
  "test/hardening.test.ts",
  "test/storage.test.ts",
  "test/journal.test.ts",
  "test/journal-benchmark.ts",
  "test/goal-recovery.test.ts",
  "test/task-recovery.test.ts",
  "test/recorded-memory-sqlite.test.ts",
];

export default defineConfig({
  test: {
    environment: "node",
    projects: [
      { extends: true, test: { name: "sqlite" } },
      project("postgres", "postgres"),
      project("drizzle", "drizzle", adapterScenarios),
      project("prisma", "prisma", adapterScenarios),
    ],
  },
});

function project(name: string, shim: string, only?: string[]) {
  return {
    extends: true as const,
    // The scenarios are unchanged: only the store behind `SqliteDurableStore` differs.
    resolve: { alias: [{ find: /^(\.\.\/)+src\/sqlite\.js$/, replacement: shimFor(shim) }] },
    test: {
      name,
      env: { ANVIA_TEST_STORE: "postgres" },
      testTimeout: 30_000,
      hookTimeout: 30_000,
      maxWorkers: 4,
      sequence: { groupOrder: name === "postgres" ? 1 : name === "drizzle" ? 2 : 3 },
      include: only ?? ["**/*.{test,spec}.?(c|m)[jt]s?(x)"],
      exclude: ["**/node_modules/**", ...sqliteOnly],
    },
  };
}
