import { AgentBuilder } from "@anvia/core/agent";
import { GrokClient, tools as grokTools } from "@anvia/grok";

const grok = new GrokClient({
  apiKey: process.env.XAI_API_KEY,
});

const researcher = new AgentBuilder("grok-researcher", grok.completionModel())
  .instructions("Research current information and cite the sources you use.")
  .tools([
    grokTools.webSearch({ allowedDomains: ["x.ai"] }),
    grokTools.xSearch({ allowedHandles: ["xai"] }),
  ])
  .additionalParams({ max_turns: 5 })
  .build();

const response = await researcher.prompt("What are the latest xAI product updates?").send();

console.log(response.output);
console.log(response.sources);
console.log(response.providerToolCalls);
