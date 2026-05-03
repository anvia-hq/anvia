import { Message, UserContent } from "@anvia/core/completion";
import { GeminiCompletionModel } from "@anvia/gemini";

const model = new GeminiCompletionModel(
  {
    models: {
      generateContent: async (params: unknown) => {
        calls.push(params);
        return { candidates: [{ content: { parts: [{ text: "accepted" }] } }] };
      },
      generateContentStream: async () => {
        throw new Error("This example only uses non-streaming completion.");
      },
    },
  } as never,
  "gemini-3.1-flash-lite-preview",
);

const calls: unknown[] = [];

console.log("Provider:", model.provider);
console.log("Default model:", model.defaultModel);
console.log("Capabilities:", model.capabilities);

await model.completion({
  chatHistory: [
    Message.user([
      UserContent.text("Summarize this report."),
      UserContent.documentBase64("JVBERi0xLjQ=", "application/pdf", {
        filename: "report.pdf",
      }),
    ]),
  ],
  documents: [],
  tools: [],
});

console.log("Document input reached provider:", calls.length === 1);
