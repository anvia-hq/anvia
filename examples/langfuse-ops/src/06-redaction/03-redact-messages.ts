// Demonstrates: redactMessages on a chat history. Only `text` parts are
// redacted; non-text parts are left alone.

import { Message, UserContent } from "@anvia/core/completion";
import { createPiiRedactor } from "@anvia/langfuse";

function main(): void {
  const redactor = createPiiRedactor();
  const messages = [
    Message.system("You are a support agent."),
    Message.user([UserContent.text("Email me at alice@example.com, please.")]),
    Message.assistant("Sure, I'll reach out shortly."),
  ];
  const safe = redactor.redactMessages(messages);
  console.log("[redaction:03] redacted messages:", JSON.stringify(safe, null, 2));
}

try {
  main();
} catch (error: unknown) {
  console.error("[redaction:03] failed:", error);
  process.exit(1);
}
