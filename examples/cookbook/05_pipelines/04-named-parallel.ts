import { Pipeline } from "@anvia/core/pipeline";
import { z } from "zod";

const classifyText = new Pipeline({ id: "classify-text", inputSchema: z.string() }).step({
  id: "classify",
  run: ({ input }) => ({
    topic: input.toLowerCase().includes("payment") ? "billing" : "operations",
  }),
});

const extractSignals = new Pipeline({ id: "extract-signals", inputSchema: z.string() }).step({
  id: "extract",
  run: ({ input }) => ({
    hasOutage: input.toLowerCase().includes("outage"),
    hasEnterpriseCustomer: input.toLowerCase().includes("enterprise"),
  }),
});

const estimatePriority = new Pipeline({ id: "estimate-priority", inputSchema: z.string() }).step({
  id: "estimate",
  run: ({ input }) => ({
    priority:
      input.toLowerCase().includes("outage") || input.toLowerCase().includes("missed orders")
        ? "high"
        : "normal",
  }),
});

const triage = new Pipeline({ id: "triage", inputSchema: z.string() })
  .parallel({
    id: "signals",
    branches: {
      classification: classifyText,
      signals: extractSignals,
      priority: estimatePriority,
    },
  })
  .step({
    id: "merge",
    run: ({ input: { classification, signals, priority } }) => ({
      ...classification,
      ...signals,
      ...priority,
    }),
  });

const result = await triage.run({
  input:
    "Enterprise customer reports checkout outage and missed orders after payment retries failed.",
});

console.log(result.output);
