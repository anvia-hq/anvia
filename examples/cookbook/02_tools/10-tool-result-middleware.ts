import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "@anvia/core/agent";
import { createMiddleware, createTool } from "@anvia/core/tool";
import { OpenAIClient } from "@anvia/openai";
import { z } from "zod";

const longReportTool = createTool({
  name: "long_report",
  description: "Return a long internal report for a topic.",
  inputSchema: z.object({
    topic: z.string(),
  }),
  outputSchema: z.string(),
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

const outputGate = createMiddleware({
  async onToolOutput({ toolName, result, internalCallId }) {
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
  baseUrl: process.env.OPENAI_BASEURL,
  apiKey: process.env.OPENAI_API_KEY ?? "",
});
const agentModel = client.completionModel({ modelId: "gpt-5.5", api: "responses" });
const agent = new Agent({
  id: "agent",
  model: agentModel,
  instructions: "Use tools when useful. Summarize tool results briefly.",
  middlewares: [outputGate],
  maxTurns: 2,
  tools: [longReportTool],
});

const response = await agent.generate({
  prompt: "Create a short update from the long report about onboarding.",
});

if (response.status !== "completed") throw new Error("Unexpected tool approval request.");
console.log(response.output);
