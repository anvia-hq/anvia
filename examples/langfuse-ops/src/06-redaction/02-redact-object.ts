// Demonstrates: redactObject on a nested object with mixed types.

import { createPiiRedactor } from "@anvia/langfuse";

function main(): void {
  const redactor = createPiiRedactor();
  const input = {
    user: {
      name: "Alice",
      email: "alice@example.com",
      contacts: [
        { kind: "phone", value: "+1 (415) 555-0123" },
        { kind: "ip", value: "10.0.0.1" },
      ],
    },
    count: 7,
    active: true,
  };
  const redacted = redactor.redactObject(input);
  console.log("[redaction:02] input:", JSON.stringify(input, null, 2));
  console.log("[redaction:02] redacted:", JSON.stringify(redacted, null, 2));
}

try {
  main();
} catch (error: unknown) {
  console.error("[redaction:02] failed:", error);
  process.exit(1);
}
