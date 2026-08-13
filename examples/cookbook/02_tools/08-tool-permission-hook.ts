import { Agent } from "@anvia/core/agent";
import { createTool } from "@anvia/core/tool";
import { OpenAIClient } from "@anvia/openai";
import { z } from "zod";

const getServiceStatusTool = createTool({
  name: "get_service_status",
  description: "Read the public status for a customer-facing service.",
  inputSchema: z.object({
    service: z.string().describe("The service name."),
  }),
  outputSchema: z.object({
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
  inputSchema: z.object({
    employeeId: z.string().describe("The employee id."),
  }),
  outputSchema: z.string(),
  requiresApproval: { reason: "Payroll data requires explicit human approval." },
  execute({ employeeId }) {
    return `Payroll record for ${employeeId}`;
  },
});

const deleteAccountTool = createTool({
  name: "delete_account",
  description: "Delete a customer account permanently.",
  inputSchema: z.object({
    accountId: z.string().describe("The account id."),
  }),
  outputSchema: z.string(),
  requiresApproval: ({ accountId }) => ({
    reason: `Permanently delete account ${accountId}?`,
  }),
  execute({ accountId }) {
    return `Deleted account ${accountId}`;
  },
});

const client = new OpenAIClient({
  baseUrl: process.env.OPENAI_BASEURL,
  apiKey: process.env.OPENAI_API_KEY,
});
const agentModel = client.completionModel("gpt-5.5");
const agent = new Agent({
  id: "agent",
  model: agentModel,
  instructions: "Use tools for service status and administrative requests.",
  maxTurns: 3,
  tools: [getServiceStatusTool, readPayrollTool, deleteAccountTool],
});

let result = await agent.generate(
  "Check the status for billing, read payroll for employee E-1024, then delete account ACC-9001.",
);

while (result.status === "approval_required") {
  console.log("approval required:", result.approval.toolName, result.approval.reason);
  result = await agent.resume(result, {
    approved: false,
    reason: "This example rejects sensitive operations.",
  });
}

console.log(result.output);
