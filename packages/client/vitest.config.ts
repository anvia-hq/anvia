import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
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
      "@anvia/core": fileURLToPath(new URL("../core/src/index.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
  },
});
