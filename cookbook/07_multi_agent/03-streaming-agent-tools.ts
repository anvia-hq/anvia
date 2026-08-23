import type { AgentStreamEvent } from "@anvia/core/agent";
import { Agent } from "@anvia/core/agent";
import { OpenAIClient } from "@anvia/openai";

const client = new OpenAIClient({
  baseUrl: process.env.OPENAI_BASEURL,
  apiKey: process.env.OPENAI_API_KEY ?? "",
});

const model = client.completionModel({ modelId: "gpt-5.5", api: "responses" });

const supportAgent = new Agent({
  id: "support",
  model: model,
  name: "Support Specialist",
  description: "Summarize customer impact and support next steps.",
  instructions: "Return compact support triage bullets using only the provided facts.",
});

const engineeringAgent = new Agent({
  id: "engineering",
  model: model,
  name: "Engineering Specialist",
  description: "Summarize diagnostics and engineering next steps.",
  instructions: "Return compact engineering triage bullets without unverified root-cause claims.",
});

const coordinator = new Agent({
  id: "coordinator",
  model: model,
  name: "Incident Coordinator",
  instructions: [
    "Coordinate specialist agents through tools.",
    "Call specialists when their expertise is useful.",
    "Combine specialist findings into one concise incident brief.",
  ].join("\n"),
  maxTurns: 4,
  tools: [
    supportAgent.asTool({ name: "ask_support_agent", stream: true, suspension: "reject" }),
    engineeringAgent.asTool({
      name: "ask_engineering_agent",
      stream: true,
      suspension: "reject",
    }),
  ],
});

const prompt = [
  "Acme Co. reports webhook retries fail for payloads larger than 512 KB.",
  "They have missed several order updates in the last hour.",
  "Prepare an incident brief for support and engineering.",
].join(" ");

for await (const event of coordinator.stream({ prompt, toolConcurrency: 2 })) {
  renderEvent(event);
}

function renderEvent(event: AgentStreamEvent): void {
  if (event.type === "tool_call") {
    console.log("\ndelegating:", event.toolCall.toolName);
  }

  if (event.type === "agent_tool_event") {
    renderChildEvent(event.agentName ?? event.agentId, event.event);
  }

  if (event.type === "text_delta") {
    process.stdout.write(event.delta);
  }

  if (event.type === "response") {
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
    console.log(`\n[${agentLabel}] tool call:`, event.toolCall.toolName);
  }

  if (event.type === "tool_result") {
    console.log(`\n[${agentLabel}] tool result:`, event.toolName);
  }
}
