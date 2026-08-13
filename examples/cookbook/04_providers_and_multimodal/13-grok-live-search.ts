import { Agent } from "@anvia/core/agent";
import { GrokClient, tools as grokTools } from "@anvia/grok";

const grok = new GrokClient({
  apiKey: process.env.XAI_API_KEY,
});

const researcher = new Agent({
  id: "grok-researcher",
  model: grok.completionModel(),
  instructions: "Research current information and cite the sources you use.",
  additionalParams: { max_turns: 5 },
  tools: [
    grokTools.webSearch({ allowedDomains: ["x.ai"] }),
    grokTools.xSearch({ allowedHandles: ["xai"] }),
  ],
});

const response = await researcher.generate("What are the latest xAI product updates?");

if (response.status !== "completed") throw new Error("Unexpected tool approval request.");
console.log(response.output);
console.log(response.sources);
console.log(response.providerToolCalls);
