// Demonstrates: a custom replacement string instead of [REDACTED].

import { createPiiRedactor } from "@anvia/langfuse";

function main(): void {
  const redactor = createPiiRedactor({ replacement: "[HIDDEN]" });
  console.log(
    "[redaction:05] custom replacement:",
    redactor.redactString("Send to alice@example.com."),
  );
}

try {
  main();
} catch (error: unknown) {
  console.error("[redaction:05] failed:", error);
  process.exit(1);
}
