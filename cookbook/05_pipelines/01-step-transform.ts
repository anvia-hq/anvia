import { Pipeline } from "@anvia/core/pipeline";
import { z } from "zod";

const normalizeIncident = new Pipeline({ id: "normalize-incident", inputSchema: z.string() })
  .step({ id: "trim", run: ({ input }) => input.trim() })
  .step({ id: "collapse-whitespace", run: ({ input }) => input.replace(/\s+/g, " ") })
  .step({
    id: "summarize",
    run: ({ input }) => ({
      normalized: input,
      wordCount: input.split(" ").length,
      priority: input.toLowerCase().includes("outage") ? "high" : "normal",
    }),
  });

const result = await normalizeIncident.run({
  input: "  Checkout outage reported by three enterprise customers.  ",
});

console.log(result.output);
