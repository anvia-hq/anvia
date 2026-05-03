import { AgentBuilder } from "@anvia/core/agent";
import { Message, UserContent } from "@anvia/core/completion";
import { OpenAIClient } from "@anvia/openai";

const client = new OpenAIClient({ apiKey: process.env.OPENAI_API_KEY });
const agentModel = client.completionModel("gpt-5.4");
const agent = new AgentBuilder("agent", agentModel)
  .instructions("Summarize attached documents in concise bullets.")
  .build();

// Document content parts include a URL, MIME type, and optional filename.
const response = await agent
  .prompt(
    Message.user([
      UserContent.text("Summarize this PDF."),
      UserContent.documentUrl(
        "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
        "application/pdf",
        { filename: "dummy.pdf" },
      ),
    ]),
  )
  .send();

console.log(response.output);
