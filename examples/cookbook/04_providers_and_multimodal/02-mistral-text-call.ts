import { AgentBuilder } from "@anvia/core/agent";
import { MistralClient } from "@anvia/mistral";

const client = new MistralClient({
  apiKey: process.env.MISTRAL_API_KEY,
});

const agentModel = client.completionModel("mistral-large-latest");

const agent = new AgentBuilder("mistral-agent", agentModel)
  .instructions("You are a concise assistant. Answer in two sentences or less.")
  .build();

const response = await agent.prompt("Explain what a context-aware agent does.").send();

console.log(response.output);
