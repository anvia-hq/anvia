import { readdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import mdx from "fumadocs-mdx/vite";
import { defineConfig } from "vite";

const docsContentDir = resolve(import.meta.dirname, "content/docs");

function getDocsPrerenderPages(dir = docsContentDir): Array<{
  path: string;
  prerender: { enabled: true };
}> {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(dir, entry.name);

      if (entry.isDirectory()) {
        return getDocsPrerenderPages(path);
      }

      if (!entry.isFile() || !/\.(md|mdx)$/.test(entry.name)) {
        return [];
      }

      const slug = relative(docsContentDir, path)
        .replace(/\.(md|mdx)$/, "")
        .split(sep)
        .join("/")
        .replace(/(^|\/)index$/, "");

      return [
        {
          path: slug ? `/docs/${slug}` : "/docs",
          prerender: { enabled: true as const },
        },
      ];
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}

export default defineConfig({
  server: {
    port: 3000,
  },
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    mdx(await import("./source.config")),
    tailwindcss(),
    tanstackStart({
      prerender: {
        enabled: true,
        autoSubfolderIndex: true,
        autoStaticPathsDiscovery: true,
        concurrency: 14,
        crawlLinks: true,
        filter: ({ path }) => !path.startsWith("/api/"),
        retryCount: 2,
        retryDelay: 1000,
        maxRedirects: 5,
        failOnError: true,
      },
      pages: getDocsPrerenderPages(),
    }),
    react(),
  ],
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "src"),
    },
    tsconfigPaths: true,
  },
});
