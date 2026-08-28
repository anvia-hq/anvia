import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@anvia/client": fileURLToPath(new URL("../client/src/index.ts", import.meta.url)),
      "@anvia/core/agent/interactions": fileURLToPath(
        new URL("../core/src/agent/interactions/index.ts", import.meta.url),
      ),
      "@anvia/core/agent": fileURLToPath(new URL("../core/src/agent/index.ts", import.meta.url)),
      "@anvia/core/completion": fileURLToPath(
        new URL("../core/src/completion/index.ts", import.meta.url),
      ),
      "@anvia/core/guardrails": fileURLToPath(
        new URL("../core/src/guardrails/index.ts", import.meta.url),
      ),
      "@anvia/core/memory": fileURLToPath(new URL("../core/src/memory/index.ts", import.meta.url)),
      "@anvia/core": fileURLToPath(new URL("../core/src/index.ts", import.meta.url)),
    },
  },
  test: {
    environment: "happy-dom",
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      thresholds: {
        branches: 85,
        functions: 85,
        lines: 85,
        statements: 85,
      },
    },
  },
});
