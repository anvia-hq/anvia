import { Agent, AgentTeam } from "@anvia/core/agent";
import { OpenAIClient } from "@anvia/openai";

const client = new OpenAIClient({
  baseUrl: process.env.OPENAI_BASEURL,
  apiKey: process.env.OPENAI_API_KEY ?? "",
});
const model = client.completionModel({ modelId: "gpt-5.5", api: "responses" });

const specialist = new Agent({
  id: "specialist",
  model,
  description: "Analyze one aspect of a software architecture using the supplied facts.",
  instructions: [
    "Focus on the specialty and task assigned in your prompt.",
    "If an essential fact is missing, send_message to parent and wait_for_agent.",
    "Keep findings concise and label assumptions.",
  ].join("\n"),
});

const reviewer = new Agent({
  id: "reviewer",
  model,
  description: "Check a proposal for unsupported claims and overlooked tradeoffs.",
  instructions: "Review the supplied findings and report concrete corrections to your parent.",
});

const team = new AgentTeam({
  id: "architecture-team",
  model,
  instructions: [
    "Spawn two specialist instances: one for reliability and one for operational complexity.",
    "Send each the relevant user facts. Answer their clarification questions through send_message.",
    "Wait for both findings, then spawn a reviewer with the combined findings.",
    "Use the review to produce a concise recommendation.",
  ].join("\n"),
  members: [specialist, reviewer],
  limits: { maxConcurrentAgents: 3, maxAgentInstances: 5, maxTotalTurns: 30 },
});

const stream = team.stream({
  prompt: [
    "Compare a managed job queue with an in-process background queue.",
    "We run a Node.js API on three replicas and must survive instance restarts.",
    "Traffic is 50 jobs per minute; each job usually finishes within 10 seconds.",
    "Our team has two engineers and no dedicated infrastructure owner.",
  ].join("\n"),
});

for await (const event of stream.events) {
  if (event.type === "agent_started") {
    console.log("started", event.member.agentId, event.instanceId);
  } else if (event.type === "message_delivered") {
    console.log("message", event.message.fromInstanceId, "->", event.message.toInstanceId);
  }
}

const result = await stream.result;
if (result.type === "response") console.log(result.output);
else console.log("Blocked:", result.reason);
console.log("Total usage:", result.usage);
