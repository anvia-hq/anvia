import { GeminiClient } from "@anvia/gemini";

const calls: unknown[] = [];
const client = new GeminiClient({
  client: {
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
});
const model = client.completionModel({ modelId: "gemini-3.1-flash-lite-preview" });

console.log("Provider:", model.provider);
console.log("Model ID:", model.modelId);
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
