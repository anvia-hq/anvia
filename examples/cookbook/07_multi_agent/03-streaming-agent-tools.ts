import { AgentBuilder } from "@anvia/core/agent";
import type { AgentStreamEvent } from "@anvia/core/request";
import { OpenAIClient } from "@anvia/openai";

const client = new OpenAIClient({
  baseUrl: process.env.OPENAI_BASEURL,
  apiKey: process.env.OPENAI_API_KEY,
});

const model = client.completionModel("gpt-5.5");

const supportAgent = new AgentBuilder("support", model)
  .name("Support Specialist")
  .description("Summarize customer impact and support next steps.")
  .instructions("Return compact support triage bullets using only the provided facts.")
  .build();

const engineeringAgent = new AgentBuilder("engineering", model)
  .name("Engineering Specialist")
  .description("Summarize diagnostics and engineering next steps.")
  .instructions("Return compact engineering triage bullets without unverified root-cause claims.")
  .build();

const coordinator = new AgentBuilder("coordinator", model)
  .name("Incident Coordinator")
  .instructions(
    [
      "Coordinate specialist agents through tools.",
      "Call specialists when their expertise is useful.",
      "Combine specialist findings into one concise incident brief.",
    ].join("\n"),
  )
  .tools([
    supportAgent.asTool({ name: "ask_support_agent", stream: true }),
    engineeringAgent.asTool({ name: "ask_engineering_agent", stream: true }),
  ])
  .defaultMaxTurns(4)
  .build();

const prompt = [
  "Acme Co. reports webhook retries fail for payloads larger than 512 KB.",
  "They have missed several order updates in the last hour.",
  "Prepare an incident brief for support and engineering.",
].join(" ");

for await (const event of coordinator.prompt(prompt).withToolConcurrency(2).stream()) {
  renderEvent(event);
}

function renderEvent(event: AgentStreamEvent): void {
  if (event.type === "tool_call") {
    console.log("\ndelegating:", event.toolCall.function.name);
  }

  if (event.type === "agent_tool_event") {
    renderChildEvent(event.agentName ?? event.agentId, event.event);
  }

  if (event.type === "text_delta") {
    process.stdout.write(event.delta);
  }

  if (event.type === "final") {
    process.stdout.write("\n");
  }
}

function renderChildEvent(
  agentLabel: string,
  event: Extract<AgentStreamEvent, { type: "agent_tool_event" }>["event"],
): void {
  if (event.type === "text_delta") {
    process.stdout.write(`\n[${agentLabel}] ${event.delta}`);
  }

  if (event.type === "tool_call") {
    console.log(`\n[${agentLabel}] tool call:`, event.toolCall.function.name);
  }

  if (event.type === "tool_result") {
    console.log(`\n[${agentLabel}] tool result:`, event.toolName);
  }
}
