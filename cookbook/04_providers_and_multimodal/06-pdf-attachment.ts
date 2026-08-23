import { Agent } from "@anvia/core/agent";
import { OpenAIClient } from "@anvia/openai";

const client = new OpenAIClient({
  baseUrl: process.env.OPENAI_BASEURL,
  apiKey: process.env.OPENAI_API_KEY ?? "",
});
const agentModel = client.completionModel({ modelId: "gpt-5.5", api: "responses" });
const agent = new Agent({
  id: "agent",
  model: agentModel,
  instructions: "Summarize attached documents in concise bullets.",
});

// Document content parts include a URL, MIME type, and optional filename.
const response = await agent.generate({
  prompt: {
    role: "user",
    content: [
      { type: "text", text: "Summarize this PDF." },
      {
        type: "file",
        data: {
          type: "url",
          url: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
        },
        mediaType: "application/pdf",
        filename: "dummy.pdf",
      },
    ],
  },
});

if (response.type !== "response") throw new Error("Unexpected tool approval request.");
console.log(response.output);
