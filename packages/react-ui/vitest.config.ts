import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@anvia/core/completion": new URL("../core/src/completion/index.ts", import.meta.url)
        .pathname,
      "@anvia/core/request": new URL("../core/src/request/index.ts", import.meta.url).pathname,
      "@anvia/core/ui": new URL("../core/src/ui/index.ts", import.meta.url).pathname,
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
