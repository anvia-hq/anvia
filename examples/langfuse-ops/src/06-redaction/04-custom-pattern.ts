// Demonstrates: adding a custom regex pattern (e.g. SSN).

import { createPiiRedactor } from "@anvia/langfuse";

function main(): void {
  const redactor = createPiiRedactor({
    patterns: [{ name: "ssn", regex: /\b\d{3}-\d{2}-\d{4}\b/g }],
  });
  console.log("[redaction:04] pattern names:", redactor.patternNames());
  console.log(
    "[redaction:04] ssn:",
    redactor.redactString("My SSN is 123-45-6789 and my email is alice@example.com."),
  );
}

try {
  main();
} catch (error: unknown) {
  console.error("[redaction:04] failed:", error);
  process.exit(1);
}
