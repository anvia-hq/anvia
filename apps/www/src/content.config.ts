import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

const docs = defineCollection({
  loader: glob({ base: "./src/content/docs", pattern: "**/*.{md,mdx}" }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    section: z.enum(["basics", "advanced", "studio", "providers", "examples", "packages"]),
    sidebar: z.object({
      group: z.string(),
      order: z.number(),
      label: z.string().optional(),
    }),
    home: z
      .object({
        card: z.boolean().optional(),
        order: z.number().optional(),
      })
      .optional(),
    draft: z.boolean().optional(),
  }),
});

export const collections = { docs };
