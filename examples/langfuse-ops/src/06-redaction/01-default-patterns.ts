// Demonstrates: DEFAULT_PATTERNS and redactString. No tracing required
// (this demo does not call the Langfuse API) so it can run offline.

import { createPiiRedactor, DEFAULT_PATTERNS } from "@anvia/langfuse";

function main(): void {
  const redactor = createPiiRedactor();
  console.log("[redaction:01] pattern names:", redactor.patternNames());
  const samples: Array<[string, string]> = [
    ["email", "Contact alice@example.com for details."],
    ["credit card (Luhn-valid)", "Charge 4111 1111 1111 1111 today."],
    ["ipv4", "Server at 192.168.1.42 is down."],
    ["phone", "Call +1 (415) 555-0123 now."],
    ["jwt", "Token: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1MSJ9.abc"],
    ["api key", "Use sk-abcdef0123456789abcdef01 to authenticate."],
  ];
  for (const [label, value] of samples) {
    console.log(`[redaction:01] ${label}:`, redactor.redactString(value));
  }
  console.log("[redaction:01] DEFAULT_PATTERNS count:", DEFAULT_PATTERNS.length);
}

try {
  main();
} catch (error: unknown) {
  console.error("[redaction:01] failed:", error);
  process.exit(1);
}
