// Demonstrates: redactMessages on a chat history. Only `text` parts are
// redacted; non-text parts are left alone.

import type { Message } from "@anvia/core/completion";
import { createPiiRedactor } from "@anvia/langfuse";

function main(): void {
  const redactor = createPiiRedactor();
  const messages = [
    { role: "system", content: "You are a support agent." },
    {
      role: "user",
      content: [{ type: "text", text: "Email me at alice@example.com, please." }],
    },
    { role: "assistant", content: "Sure, I'll reach out shortly." },
  ] satisfies readonly Message[];
  const safe = redactor.redactMessages(messages);
  console.log("[redaction:03] redacted messages:", JSON.stringify(safe, null, 2));
}

try {
  main();
} catch (error: unknown) {
  console.error("[redaction:03] failed:", error);
  process.exit(1);
}
