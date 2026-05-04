import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentBuilder } from "@anvia/core/agent";
import { createTool, createToolMiddleware } from "@anvia/core/tool";
import { OpenAIClient } from "@anvia/openai";
import { z } from "zod";

const longReportTool = createTool({
  name: "long_report",
  description: "Return a long internal report for a topic.",
  input: z.object({
    topic: z.string(),
  }),
  output: z.string(),
  execute: ({ topic }) =>
    [
      `Report topic: ${topic}`,
      "Revenue increased in enterprise accounts.",
      "Support volume is concentrated around onboarding.",
      "Recommended action: prioritize setup automation.",
    ]
      .join("\n")
      .repeat(20),
});

const outputGate = createToolMiddleware({
  async onResult({ toolName, result, internalCallId }) {
    if (result.length <= 1_000) {
      return undefined;
    }

    const path = join(tmpdir(), `${toolName}-${internalCallId}.txt`);
    await writeFile(path, result, "utf8");

    return JSON.stringify({
      type: "file_reference",
      reason: "tool_output_too_large",
      chars: result.length,
      path,
    });
  },
});

const client = new OpenAIClient({
  baseUrl: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});
const agentModel = client.completionModel("deepseek/deepseek-v4-pro");
const agent = new AgentBuilder("agent", agentModel)
  .instructions("Use tools when useful. Summarize tool results briefly.")
  .tool(longReportTool)
  .toolMiddleware(outputGate)
  .defaultMaxTurns(2)
  .build();

const response = await agent
  .prompt("Create a short update from the long report about onboarding.")
  .send();

console.log(response.output);
