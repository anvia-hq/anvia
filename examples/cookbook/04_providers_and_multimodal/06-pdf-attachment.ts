import { Agent } from "@anvia/core/agent";
import { Message, UserContent } from "@anvia/core/completion";
import { OpenAIClient } from "@anvia/openai";

const client = new OpenAIClient({
  baseUrl: process.env.OPENAI_BASEURL,
  apiKey: process.env.OPENAI_API_KEY,
});
const agentModel = client.completionModel("gpt-5.5");
const agent = new Agent({
  id: "agent",
  model: agentModel,
  instructions: "Summarize attached documents in concise bullets.",
});

// Document content parts include a URL, MIME type, and optional filename.
const response = await agent.generate(
  Message.user([
    UserContent.text("Summarize this PDF."),
    UserContent.documentUrl(
      "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
      "application/pdf",
      { filename: "dummy.pdf" },
    ),
  ]),
);

console.log(response.output);
