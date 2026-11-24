import { defineConfig, type UserConfig } from "tsdown";

const shared: UserConfig = {
  format: ["esm"],
  sourcemap: true,
  fixedExtension: false,
  deps: {
    neverBundle: ["react", "react-dom", "@xterm/xterm", "@xterm/addon-fit", "@novnc/novnc"],
  },
};

export const publicEntries: string[] = [
  "src/index.ts",
  "src/attachment/index.ts",
  "src/chat/index.ts",
  "src/completion/index.ts",
  "src/graph-explorer/index.ts",
  "src/human-input/index.ts",
  "src/image/index.ts",
  "src/message/index.ts",
  "src/sandbox-desktop/index.ts",
  "src/sandbox-terminal/index.ts",
  "src/selection-toolbar/index.ts",
  "src/shared.ts",
  "src/stream/index.ts",
  "src/thread-list/index.ts",
];

export default defineConfig([
  {
    ...shared,
    entry: ["src/**/*.{ts,tsx}", "!src/**/*.d.ts"],
    unbundle: true,
    dts: false,
    clean: true,
  },
  {
    ...shared,
    entry: publicEntries,
    dts: { emitDtsOnly: true },
    clean: false,
  },
]);
