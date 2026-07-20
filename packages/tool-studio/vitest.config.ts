import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: {
      "@anvia/react-ui/stream": new URL("../react-ui/src/stream/index.ts", import.meta.url)
        .pathname,
      "@anvia/react": new URL("../react/src/index.ts", import.meta.url).pathname,
      "@anvia/core/agent": new URL("../core/src/agent/index.ts", import.meta.url).pathname,
      "@anvia/core/completion": new URL("../core/src/completion/index.ts", import.meta.url)
        .pathname,
      "@anvia/core/embeddings": new URL("../core/src/embeddings/index.ts", import.meta.url)
        .pathname,
      "@anvia/core/evals": new URL("../core/src/evals/index.ts", import.meta.url).pathname,
      "@anvia/core/internal/agent": new URL("../core/src/internal/agent.ts", import.meta.url)
        .pathname,
      "@anvia/core/hooks": new URL("../core/src/hooks/index.ts", import.meta.url).pathname,
      "@anvia/core/mcp": new URL("../core/src/mcp/index.ts", import.meta.url).pathname,
      "@anvia/core/memory": new URL("../core/src/memory/index.ts", import.meta.url).pathname,
      "@anvia/core/observability": new URL("../core/src/observability/index.ts", import.meta.url)
        .pathname,
      "@anvia/core/pipeline": new URL("../core/src/pipeline/index.ts", import.meta.url).pathname,
      "@anvia/core/request": new URL("../core/src/request/index.ts", import.meta.url).pathname,
      "@anvia/core/tool": new URL("../core/src/tool/index.ts", import.meta.url).pathname,
      "@anvia/core/ui": new URL("../core/src/ui/index.ts", import.meta.url).pathname,
      "@anvia/core/vector-store": new URL("../core/src/vector-store/index.ts", import.meta.url)
        .pathname,
      "@anvia/core": new URL("../core/src/index.ts", import.meta.url).pathname,
      "@": new URL("./src/ui/app", import.meta.url).pathname,
    },
  },
  test: {
    coverage: {
      thresholds: {
        statements: 80,
        branches: 65,
        functions: 80,
        lines: 80,
      },
    },
    environment: "node",
  },
});
