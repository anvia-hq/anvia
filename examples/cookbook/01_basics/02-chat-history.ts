import { AgentBuilder } from "@anvia/core/agent";
import { Message } from "@anvia/core/completion";
import { OpenAIClient } from "@anvia/openai";

const client = new OpenAIClient({
  baseUrl: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});
const agentModel = client.completionModel("deepseek/deepseek-v4-pro");

const agent = new AgentBuilder("agent", agentModel)
  .instructions("You are a concise assistant that respects prior conversation context.")
  .build();

const history = [
  Message.user("My project is named Anvia."),
  Message.assistant("Noted. Your project is named Anvia."),
];

const response = await agent.prompt("What is my project named?").withHistory(history).send();

console.log(response.output);
