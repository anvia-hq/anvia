import { AgentBuilder } from "@anvia/core/agent";
import { OpenAIClient } from "@anvia/openai";

const client = new OpenAIClient({
  baseUrl: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});
const agentModel = client.completionModel("deepseek/deepseek-v4-pro");
const agent = new AgentBuilder("agent", agentModel)
  .instructions("Answer from the supplied context when it is relevant.")
  // Static context is sent with every request to this agent.
  .context(
    [
      "DeltaKit Launch Policy",
      "Every production launch must have one launch captain.",
      "The launch captain owns the rollback checklist, customer notice, and go/no-go decision.",
      "For checkout launches, the default launch captain is Mira.",
    ].join("\n"),
    "launch_policy",
  )
  .context(
    [
      "Support Escalation Notes",
      "Checkout incidents with payment failure reports should be treated as high priority.",
      "The product engineer should include recent gateway error rates in the summary.",
    ].join("\n"),
    "support_escalation_notes",
  )
  .build();

const response = await agent
  .prompt("Who owns the checkout launch checklist, and what should the engineer include?")
  .send();

console.log(response.output);
