import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Subprocess startup and SQLite recovery need headroom on shared CI runners.
    testTimeout: 30_000,
    hookTimeout: 15_000,
  },
});
