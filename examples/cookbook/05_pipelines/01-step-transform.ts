import { Pipeline } from "@anvia/core/pipeline";
import { z } from "zod";

const normalizeIncident = new Pipeline({ id: "normalize-incident", inputSchema: z.string() })
  .step((input) => input.trim())
  .step((input) => input.replace(/\s+/g, " "))
  .step((input) => ({
    normalized: input,
    wordCount: input.split(" ").length,
    priority: input.toLowerCase().includes("outage") ? "high" : "normal",
  }));

const result = await normalizeIncident.run(
  "  Checkout outage reported by three enterprise customers.  ",
);

console.log(result);
