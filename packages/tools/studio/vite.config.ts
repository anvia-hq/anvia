import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "src/ui/app",
  base: "/ui/",
  publicDir: resolve(import.meta.dirname, "src/ui/public"),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "src/ui/app"),
    },
    dedupe: ["react", "react-dom"],
  },
  build: {
    outDir: resolve(import.meta.dirname, "dist/ui"),
    emptyOutDir: true,
    sourcemap: true,
  },
});
