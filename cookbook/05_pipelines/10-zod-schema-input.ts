import { Pipeline } from "@anvia/core/pipeline";
import { z } from "zod";

const SearchInput = z.object({
  query: z.string().min(1).describe("Search query string"),
  limit: z.number().int().positive().default(10).describe("Maximum results"),
});

async function search(query: string, limit: number): Promise<string[]> {
  await Promise.resolve();
  return Array.from({ length: limit }, (_, index) => `${query} #${index + 1}`);
}

const searchPipeline = new Pipeline({
  id: "search",
  inputSchema: SearchInput,
  name: "Search Pipeline",
  description: "Validates input with a Zod schema, then runs a search.",
})
  .step({
    id: "search",
    run: ({ input: { query, limit } }) => search(query, limit ?? 10),
  })
  .step({
    id: "summarize",
    run: ({ input }) => ({ query: input[0]?.split(" #")[0] ?? "", count: input.length }),
  });

const result = await searchPipeline.run({ input: { query: "anvia" } });

console.log(result.output);
console.log(searchPipeline.name);

try {
  await searchPipeline.run({ input: { query: "" } as { query: string; limit?: number } });
} catch (error) {
  console.log(
    "validation rejected:",
    error instanceof z.ZodError ? error.issues[0]?.message : error,
  );
}
