import { AgentBuilder } from "@anvia/core/agent";
import { GrokClient } from "@anvia/grok";

const client = new GrokClient({
  apiKey: process.env.XAI_API_KEY,
});

const agentModel = client.completionModel("grok-4.3");

const agent = new AgentBuilder("grok-agent", agentModel)
  .instructions("You are a concise assistant. Answer in two sentences or less.")
  .build();

const response = await agent.prompt("Explain what a context-aware agent does.").send();
console.log(response.output);
