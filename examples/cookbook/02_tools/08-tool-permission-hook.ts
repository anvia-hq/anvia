import { AgentBuilder, createHook, PromptCancelledError } from "@anvia/core/agent";
import { createTool } from "@anvia/core/tool";
import { OpenAIClient } from "@anvia/openai";
import { z } from "zod";

const getServiceStatusTool = createTool({
  name: "get_service_status",
  description: "Read the public status for a customer-facing service.",
  input: z.object({
    service: z.string().describe("The service name."),
  }),
  output: z.object({
    service: z.string(),
    status: z.string(),
  }),
  execute({ service }) {
    return {
      service,
      status: "operational",
    };
  },
});

const readPayrollTool = createTool({
  name: "read_payroll",
  description: "Read payroll information for an employee.",
  input: z.object({
    employeeId: z.string().describe("The employee id."),
  }),
  output: z.string(),
  execute({ employeeId }) {
    return `Payroll record for ${employeeId}`;
  },
});

const deleteAccountTool = createTool({
  name: "delete_account",
  description: "Delete a customer account permanently.",
  input: z.object({
    accountId: z.string().describe("The account id."),
  }),
  output: z.string(),
  execute({ accountId }) {
    return `Deleted account ${accountId}`;
  },
});

const permissionHook = createHook({
  onToolCall({ toolName, tool }) {
    // Hooks can allow, skip, request approval, or terminate tool calls before execution.
    if (toolName === "read_payroll") {
      return tool.skip("Payroll data is restricted. Summarize that access was denied.");
    }

    if (toolName === "delete_account") {
      return tool.requestApproval({
        reason: "Account deletion requires explicit human approval.",
        rejectMessage: "Account deletion was not approved.",
      });
    }

    return tool.run();
  },
  onToolResult({ toolName, result }) {
    console.log("tool result:", toolName, result);
  },
});

const client = new OpenAIClient({
  baseUrl: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});
const agentModel = client.completionModel("deepseek/deepseek-v4-pro");
const agent = new AgentBuilder("agent", agentModel)
  .instructions("Use tools for service status and administrative requests.")
  .tools([getServiceStatusTool, readPayrollTool, deleteAccountTool])
  .hook(permissionHook)
  .defaultMaxTurns(3)
  .build();

try {
  const response = await agent
    .prompt(
      "Check the status for billing, read payroll for employee E-1024, then delete account ACC-9001.",
    )
    .send();

  console.log(response.output);
} catch (error) {
  if (error instanceof PromptCancelledError) {
    // Without Studio or another approval handler, requestApproval cancels clearly.
    console.log("prompt cancelled:", error.reason);
  } else {
    throw error;
  }
}
