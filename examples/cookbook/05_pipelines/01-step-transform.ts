import { PipelineBuilder } from "@anvia/core/pipeline";
import { z } from "zod";

const normalizeIncident = new PipelineBuilder(z.string())
  .step((input) => input.trim())
  .step((input) => input.replace(/\s+/g, " "))
  .step((input) => ({
    normalized: input,
    wordCount: input.split(" ").length,
    priority: input.toLowerCase().includes("outage") ? "high" : "normal",
  }))
  .build();

const result = await normalizeIncident.run(
  "  Checkout outage reported by three enterprise customers.  ",
);

console.log(result);
