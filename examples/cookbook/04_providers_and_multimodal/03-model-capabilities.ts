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
    {
      role: "user",
      content: [
        { type: "text", text: "Summarize this report." },
        {
          type: "file",
          data: { type: "data", data: "JVBERi0xLjQ=" },
          mediaType: "application/pdf",
          filename: "report.pdf",
        },
      ],
    },
  ],
  documents: [],
  tools: [],
});

console.log("Document input reached provider:", calls.length === 1);
