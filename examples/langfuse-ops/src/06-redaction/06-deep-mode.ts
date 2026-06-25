// Demonstrates: string vs object redaction. redactString handles one
// string; redactObject recurses through nested objects and arrays.

import { createPiiRedactor } from "@anvia/langfuse";

function main(): void {
  const redactor = createPiiRedactor();
  const input = {
    level1: {
      level2: {
        level3: "Reach me at alice@example.com",
      },
    },
  };
  const singleString = redactor.redactString("Reach me at alice@example.com");
  const nestedObject = redactor.redactObject(input);
  console.log("[redaction:06] single string:", singleString);
  console.log("[redaction:06] nested object:", JSON.stringify(nestedObject));
}

try {
  main();
} catch (error: unknown) {
  console.error("[redaction:06] failed:", error);
  process.exit(1);
}
