import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: {
      "@anvia/client/transport": fileURLToPath(
        new URL("../client/src/transport/index.ts", import.meta.url),
      ),
      "@anvia/client": fileURLToPath(new URL("../client/src/index.ts", import.meta.url)),
      "@anvia/react-ui/stream": fileURLToPath(
        new URL("../react-ui/src/stream/index.ts", import.meta.url),
      ),
      "@anvia/react": fileURLToPath(new URL("../react/src/index.ts", import.meta.url)),
      "@anvia/core/agent/interactions": fileURLToPath(
        new URL("../core/src/agent/interactions/index.ts", import.meta.url),
      ),
      "@anvia/core/agent": fileURLToPath(new URL("../core/src/agent/index.ts", import.meta.url)),
      "@anvia/core/completion": fileURLToPath(
        new URL("../core/src/completion/index.ts", import.meta.url),
      ),
      "@anvia/core/embeddings": fileURLToPath(
        new URL("../core/src/embeddings/index.ts", import.meta.url),
      ),
      "@anvia/core/evals": fileURLToPath(new URL("../core/src/evals/index.ts", import.meta.url)),
      "@anvia/core/internal/agent": fileURLToPath(
        new URL("../core/src/internal/agent.ts", import.meta.url),
      ),
      "@anvia/core/mcp": fileURLToPath(new URL("../core/src/mcp/index.ts", import.meta.url)),
      "@anvia/core/memory": fileURLToPath(new URL("../core/src/memory/index.ts", import.meta.url)),
      "@anvia/core/observability": fileURLToPath(
        new URL("../core/src/observability/index.ts", import.meta.url),
      ),
      "@anvia/core/pipeline": fileURLToPath(
        new URL("../core/src/pipeline/index.ts", import.meta.url),
      ),
      "@anvia/core/tool": fileURLToPath(new URL("../core/src/tool/index.ts", import.meta.url)),
      "@anvia/core/vector-store": fileURLToPath(
        new URL("../core/src/vector-store/index.ts", import.meta.url),
      ),
      "@anvia/core": fileURLToPath(new URL("../core/src/index.ts", import.meta.url)),
      "@": fileURLToPath(new URL("./src/ui/app", import.meta.url)),
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
