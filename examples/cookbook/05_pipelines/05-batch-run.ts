import { Pipeline } from "@anvia/core/pipeline";
import { z } from "zod";

const normalizeIncident = new Pipeline({ id: "normalize-incident", inputSchema: z.string() })
  .step({ id: "normalize", run: ({ input }) => input.trim().replace(/\s+/g, " ") })
  .step({
    id: "classify",
    run: ({ input }) => ({
      normalized: input,
      priority: input.toLowerCase().includes("outage") ? "high" : "normal",
    }),
  });

const batch = await normalizeIncident.runBatch({
  inputs: [
    "Payment latency for EU customers.",
    "Search outage for the admin dashboard.",
    "Webhook retries delayed for large payloads.",
  ],
  concurrency: 2,
});

console.log(batch);
