import { Agent } from "@anvia/core/agent";
import { OpenAIClient } from "@anvia/openai";

const client = new OpenAIClient({
  baseUrl: process.env.OPENAI_BASEURL,
  apiKey: process.env.OPENAI_API_KEY,
});
const agentModel = client.completionModel("gpt-5.5");
const agent = new Agent({
  id: "agent",
  model: agentModel,
  instructions: "Answer from the supplied context when it is relevant.",
  context: [
    {
      id: "launch_policy",
      text: [
        "DeltaKit Launch Policy",
        "Every production launch must have one launch captain.",
        "The launch captain owns the rollback checklist, customer notice, and go/no-go decision.",
        "For checkout launches, the default launch captain is Mira.",
      ].join("\n"),
    },
    {
      id: "support_escalation_notes",
      text: [
        "Support Escalation Notes",
        "Checkout incidents with payment failure reports should be treated as high priority.",
        "The product engineer should include recent gateway error rates in the summary.",
      ].join("\n"),
    },
  ],
});

const response = await agent
  .prompt("Who owns the checkout launch checklist, and what should the engineer include?")
  .send();

console.log(response.output);
