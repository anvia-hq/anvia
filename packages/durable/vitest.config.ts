import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const shim = fileURLToPath(new URL("./test/helpers/postgres-as-sqlite.ts", import.meta.url));

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
      {
        extends: true,
        // The scenarios are unchanged: only the store behind `SqliteDurableStore` differs.
        resolve: { alias: [{ find: /^(\.\.\/)+src\/sqlite\.js$/, replacement: shim }] },
        test: {
          name: "postgres",
          env: { ANVIA_TEST_STORE: "postgres" },
          testTimeout: 30_000,
          hookTimeout: 30_000,
          maxWorkers: 4,
          sequence: { groupOrder: 1 },
          exclude: ["**/node_modules/**", ...sqliteOnly],
        },
      },
    ],
  },
});
