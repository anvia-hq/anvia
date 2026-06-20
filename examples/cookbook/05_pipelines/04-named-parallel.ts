import { PipelineBuilder } from "@anvia/core/pipeline";
import { z } from "zod";

const classifyText = new PipelineBuilder(z.string())
  .step((text) => ({
    topic: text.toLowerCase().includes("payment") ? "billing" : "operations",
  }))
  .build();

const extractSignals = new PipelineBuilder(z.string())
  .step((text) => ({
    hasOutage: text.toLowerCase().includes("outage"),
    hasEnterpriseCustomer: text.toLowerCase().includes("enterprise"),
  }))
  .build();

const estimatePriority = new PipelineBuilder(z.string())
  .step((text) => ({
    priority:
      text.toLowerCase().includes("outage") || text.toLowerCase().includes("missed orders")
        ? "high"
        : "normal",
  }))
  .build();

const triage = new PipelineBuilder(z.string())
  .parallel({
    classification: classifyText,
    signals: extractSignals,
    priority: estimatePriority,
  })
  .step(({ classification, signals, priority }) => ({
    ...classification,
    ...signals,
    ...priority,
  }))
  .build();

const result = await triage.run(
  "Enterprise customer reports checkout outage and missed orders after payment retries failed.",
);

console.log(result);
