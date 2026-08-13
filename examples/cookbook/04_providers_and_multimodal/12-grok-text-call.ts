import { Agent } from "@anvia/core/agent";
import { GrokClient } from "@anvia/grok";

const client = new GrokClient({
  apiKey: process.env.XAI_API_KEY,
});

const agentModel = client.completionModel();

const agent = new Agent({
  id: "grok-agent",
  model: agentModel,
  instructions: "You are a concise assistant. Answer in two sentences or less.",
});

const response = await agent.prompt("Explain what a context-aware agent does.").send();
console.log(response.output);
