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
  instructions: "Answer visual questions briefly.",
});

// Multimodal prompts combine text with image content parts.
const response = await agent
  .prompt(
    Message.user([
      UserContent.text("What is shown in this image?"),
      UserContent.imageUrl(
        "https://upload.wikimedia.org/wikipedia/commons/3/3f/Fronalpstock_big.jpg",
        {
          detail: "auto",
        },
      ),
    ]),
  )
  .send();

console.log(response.output);
