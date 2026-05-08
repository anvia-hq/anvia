import { AgentBuilder, createHook } from "@anvia/core/agent";
import { createTool } from "@anvia/core/tool";
import { OpenAIClient } from "@anvia/openai";
import { Studio } from "@anvia/studio";
import { z } from "zod";

const client = new OpenAIClient({
  baseUrl: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});

const getOrder = createTool({
  name: "get_order",
  description: "Read an order summary from local application state.",
  input: z.object({
    id: z.string().describe("The order id to read."),
  }),
  output: z.object({
    id: z.string(),
    status: z.enum(["processing", "blocked", "shipped"]),
    customer: z.string(),
    paidAmount: z.number(),
    notes: z.string(),
  }),
  execute: ({ id }) => ({
    id,
    status: "blocked" as const,
    customer: "Delta Kit Labs",
    paidAmount: 250,
    notes: "Payment review is complete, but warehouse allocation has not been confirmed.",
  }),
});

const issueRefund = createTool({
  name: "issue_refund",
  description: "Issue a customer refund. This changes account balance and requires approval.",
  input: z.object({
    orderId: z.string().describe("The order id to refund."),
    amount: z.number().positive().describe("The refund amount in USD."),
    reason: z.string().describe("The reason to record with the refund."),
  }),
  output: z.object({
    refundId: z.string(),
    orderId: z.string(),
    amount: z.number(),
    status: z.enum(["issued"]),
  }),
  approval: {
    when: ({ args }) => args.amount > 0,
    reason: ({ args }) => `Review refund of $${args.amount} for order ${args.orderId}.`,
    rejectMessage: "Refund request rejected in Anvia Studio.",
  },
  execute: ({ orderId, amount }) => ({
    refundId: `rf_${orderId.toLowerCase()}`,
    orderId,
    amount,
    status: "issued" as const,
  }),
});

const cancelOrder = createTool({
  name: "cancel_order",
  description: "Cancel an order before fulfillment. This is guarded by a hook approval.",
  input: z.object({
    orderId: z.string().describe("The order id to cancel."),
    reason: z.string().describe("The reason to record with the cancellation."),
  }),
  output: z.object({
    orderId: z.string(),
    status: z.enum(["cancelled"]),
  }),
  execute: ({ orderId }) => ({
    orderId,
    status: "cancelled" as const,
  }),
});

const approvalHook = createHook({
  onToolCall({ toolName, args, tool }) {
    if (toolName === "cancel_order") {
      return tool.requestApproval({
        reason: `Review order cancellation request: ${args}`,
        rejectMessage: "Order cancellation rejected in Anvia Studio.",
      });
    }

    return tool.run();
  },
});

const agentModel = client.completionModel("deepseek/deepseek-v4-pro");
const agent = new AgentBuilder("studio-support-operations", agentModel)
  .name("Studio Support Operations")
  .description("Handles operational order lookups and guarded refund actions.")
  .instructions(
    [
      "Use tools for private order data and refund operations.",
      "Look up an order before issuing a refund or cancellation.",
      "Keep responses short and mention whether the guarded action was issued, cancelled, or denied.",
    ].join("\n"),
  )
  .tools([getOrder, issueRefund, cancelOrder])
  .hook(approvalHook)
  .defaultMaxTurns(5)
  .build();

new Studio([agent]).start();
