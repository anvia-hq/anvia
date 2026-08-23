import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@anvia/client": new URL("../client/src/index.ts", import.meta.url).pathname,
      "@anvia/core/agent/interactions": new URL(
        "../core/src/agent/interactions/index.ts",
        import.meta.url,
      ).pathname,
      "@anvia/core/agent": new URL("../core/src/agent/index.ts", import.meta.url).pathname,
      "@anvia/core/completion": new URL("../core/src/completion/index.ts", import.meta.url)
        .pathname,
      "@anvia/core/guardrails": new URL("../core/src/guardrails/index.ts", import.meta.url)
        .pathname,
      "@anvia/core/memory": new URL("../core/src/memory/index.ts", import.meta.url).pathname,
      "@anvia/core": new URL("../core/src/index.ts", import.meta.url).pathname,
      "@anvia/react": new URL("../react/src/index.ts", import.meta.url).pathname,
    },
  },
  test: {
    environment: "happy-dom",
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      thresholds: {
        branches: 80,
        functions: 80,
        lines: 80,
        statements: 80,
      },
    },
  },
});
