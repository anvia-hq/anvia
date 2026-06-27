// @ts-check

import mdx from "@astrojs/mdx";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

// https://astro.build/config
export default defineConfig({
  site: "https://anvia.dev",
  integrations: [mdx()],
  markdown: {
    shikiConfig: {
      theme: "vesper",
    },
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
