// Demonstrates: "deep" mode. With deep=true the redactor recurses
// into nested objects and arrays (in addition to top-level strings).
// This demo uses redactObject directly to show the effect without
// needing a full tracing setup.

import { createPiiRedactor } from "@anvia/langfuse";

function main(): void {
  const deepRedactor = createPiiRedactor();
  const shallow = createPiiRedactor();
  const input = {
    level1: {
      level2: {
        level3: "Reach me at alice@example.com",
      },
    },
  };
  const recursed = deepRedactor.redactObject(input);
  const topLevel = shallow.redactObject({ value: "Reach me at alice@example.com" });
  console.log("[redaction:06] deep (recurses):", JSON.stringify(recursed));
  console.log(
    "[redaction:06] top-level only (no recursion in redactObject):",
    JSON.stringify(topLevel),
  );
}

try {
  main();
} catch (error: unknown) {
  console.error("[redaction:06] failed:", error);
  process.exit(1);
}
