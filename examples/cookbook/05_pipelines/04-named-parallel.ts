import { Pipeline } from "@anvia/core/pipeline";
import { z } from "zod";

const classifyText = new Pipeline({ id: "classify-text", inputSchema: z.string() }).step(
  (text) => ({
    topic: text.toLowerCase().includes("payment") ? "billing" : "operations",
  }),
);

const extractSignals = new Pipeline({ id: "extract-signals", inputSchema: z.string() }).step(
  (text) => ({
    hasOutage: text.toLowerCase().includes("outage"),
    hasEnterpriseCustomer: text.toLowerCase().includes("enterprise"),
  }),
);

const estimatePriority = new Pipeline({ id: "estimate-priority", inputSchema: z.string() }).step(
  (text) => ({
    priority:
      text.toLowerCase().includes("outage") || text.toLowerCase().includes("missed orders")
        ? "high"
        : "normal",
  }),
);

const triage = new Pipeline({ id: "triage", inputSchema: z.string() })
  .parallel({
    classification: classifyText,
    signals: extractSignals,
    priority: estimatePriority,
  })
  .step(({ classification, signals, priority }) => ({
    ...classification,
    ...signals,
    ...priority,
  }));

const result = await triage.run(
  "Enterprise customer reports checkout outage and missed orders after payment retries failed.",
);

console.log(result);
