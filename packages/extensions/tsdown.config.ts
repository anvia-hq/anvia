import { defineConfig, type UserConfig } from "tsdown";

const shared: UserConfig = {
  format: ["esm"],
  sourcemap: true,
  fixedExtension: false,
};

export default defineConfig([
  {
    ...shared,
    entry: ["src/**/*.ts"],
    unbundle: true,
    dts: false,
    clean: true,
  },
  {
    ...shared,
    entry: [
      "src/index.ts",
      "src/tools/index.ts",
      "src/tools/web-search/index.ts",
      "src/tools/web-fetch/index.ts",
      "src/tools/fs/index.ts",
      "src/tools/shell/index.ts",
      "src/tools/git/index.ts",
      "src/tools/datetime/index.ts",
      "src/tools/scratchpad/index.ts",
      "src/tools/math/index.ts",
      "src/tools/http/index.ts",
      "src/tools/todo/index.ts",
      "src/guardrails/index.ts",
      "src/middlewares/index.ts",
      "src/hooks/index.ts",
    ],
    dts: { emitDtsOnly: true },
    clean: false,
  },
]);
