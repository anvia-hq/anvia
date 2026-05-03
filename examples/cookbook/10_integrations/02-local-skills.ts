import { AgentBuilder } from "@anvia/core/agent";
import { loadSkills, skill } from "@anvia/core/skills";
import { OpenAIClient } from "@anvia/openai";

const skills = await loadSkills(skill.local(new URL("../skills", import.meta.url).pathname));

const client = new OpenAIClient({
  baseUrl: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});
const agentModel = client.completionModel("deepseek/deepseek-v4-pro");
const agent = new AgentBuilder("agent", agentModel)
  .instructions(
    [
      "Use skills when they are relevant.",
      "For release note tasks, load the release-notes skill instructions, read its style reference, and run its draft script before answering.",
    ].join("\n"),
  )
  .skills(skills)
  .defaultMaxTurns(4)
  .build();

const prompt =
  "Draft release notes for Anvia: added local skills, MCP tools, streaming, and PDF/image attachments.";

for await (const event of agent.prompt(prompt).stream()) {
  if (event.type === "tool_call") {
    console.log("tool call:", event.toolCall.function.name, event.toolCall.function.arguments);
  }

  if (event.type === "tool_result") {
    console.log("tool result:", event.toolName, event.result);
  }

  if (event.type === "text_delta") {
    process.stdout.write(event.delta);
  }

  if (event.type === "final") {
    process.stdout.write("\n");
  }
}
