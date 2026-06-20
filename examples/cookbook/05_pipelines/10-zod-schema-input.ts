import { PipelineBuilder } from "@anvia/core/pipeline";
import { z } from "zod";

const SearchInput = z.object({
  query: z.string().min(1).describe("Search query string"),
  limit: z.number().int().positive().default(10).describe("Maximum results"),
});

async function search(query: string, limit: number): Promise<string[]> {
  await Promise.resolve();
  return Array.from({ length: limit }, (_, index) => `${query} #${index + 1}`);
}

const searchPipeline = new PipelineBuilder(SearchInput, {
  name: "Search Pipeline",
  description: "Validates input with a Zod schema, then runs a search.",
})
  .step(({ query, limit }) => search(query, limit ?? 10))
  .step((results) => ({ query: results[0]?.split(" #")[0] ?? "", count: results.length }))
  .build();

const result = await searchPipeline.run({ query: "anvia" });

console.log(result);
console.log(searchPipeline.name);

try {
  await searchPipeline.run({ query: "" } as { query: string; limit?: number });
} catch (error) {
  console.log(
    "validation rejected:",
    error instanceof z.ZodError ? error.issues[0]?.message : error,
  );
}
