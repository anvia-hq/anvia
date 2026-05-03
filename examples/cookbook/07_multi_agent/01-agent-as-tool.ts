import { AgentBuilder } from "@anvia/core/agent";
import { OpenAIClient } from "@anvia/openai";

const client = new OpenAIClient({
  baseUrl: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});

const supportAgentModel = client.completionModel("deepseek/deepseek-v4-pro");
const supportAgent = new AgentBuilder("support", supportAgentModel)
  .name("Support Specialist")
  .description("Delegate support triage work to the support specialist agent.")
  .instructions(
    [
      "You analyze customer support incidents.",
      "Extract customer impact, urgency, missing information, and the next support action.",
      "Use only the facts provided in the task.",
      "Return visible final text, not only reasoning.",
      "Answer in compact bullets.",
    ].join("\n"),
  )
  .build();

const engineeringAgentModel = client.completionModel("deepseek/deepseek-v4-pro");
const engineeringAgent = new AgentBuilder("engineering", engineeringAgentModel)
  .name("Engineering Specialist")
  .description("Delegate technical investigation work to the engineering specialist agent.")
  .instructions(
    [
      "You analyze product engineering incidents.",
      "Identify likely technical causes, diagnostics to run, and the safest next engineering step.",
      "Use only the facts provided in the task.",
      "Return visible final text, not only reasoning.",
      "Answer in compact bullets.",
    ].join("\n"),
  )
  .build();

const commsAgentModel = client.completionModel("deepseek/deepseek-v4-pro");
const commsAgent = new AgentBuilder("comms", commsAgentModel)
  .name("Customer Comms Specialist")
  .description("Delegate customer update drafting to the customer communications specialist.")
  .instructions(
    [
      "You draft customer-facing incident communication.",
      "Keep the message specific, calm, and free of unverified root-cause claims.",
      "Return visible final text, not only reasoning.",
      "Answer with a short customer update.",
    ].join("\n"),
  )
  .build();

const coordinatorModel = client.completionModel("deepseek/deepseek-v4-pro");
const coordinator = new AgentBuilder("coordinator", coordinatorModel)
  .name("Incident Coordinator")
  .instructions(
    [
      "You coordinate specialist agents through tools.",
      "Call the support, engineering, and communications specialists when the task needs their expertise.",
      "Give each specialist a short task based only on the facts in the user request.",
      "Combine their findings into one concise incident brief with owner-specific next steps.",
      "Use plain text bullets, no tables, and no emoji.",
    ].join("\n"),
  )
  .tools([
    supportAgent.asTool({ name: "ask_support_agent" }),
    engineeringAgent.asTool({ name: "ask_engineering_agent" }),
    commsAgent.asTool({ name: "ask_comms_agent" }),
  ])
  .defaultMaxTurns(4)
  .build();

const prompt = [
  "Acme Co. reports that webhook retries fail for payloads larger than 512 KB.",
  "They have missed several order updates in the last hour.",
  "Prepare an incident brief for support, engineering, and customer success.",
].join(" ");

for await (const event of coordinator.prompt(prompt).withToolConcurrency(3).stream()) {
  if (event.type === "tool_call") {
    console.log("delegating:", event.toolCall.function.name, event.toolCall.function.arguments);
  }

  if (event.type === "tool_result") {
    console.log("specialist result:", event.toolName, event.result);
  }

  if (event.type === "text_delta") {
    process.stdout.write(event.delta);
  }

  if (event.type === "final") {
    process.stdout.write("\n");
  }
}
