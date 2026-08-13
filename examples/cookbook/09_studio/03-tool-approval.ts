import { Agent } from "@anvia/core/agent";
import { createTool } from "@anvia/core/tool";
import { OpenAIClient } from "@anvia/openai";
import { Studio } from "@anvia/studio";
import { z } from "zod";

const client = new OpenAIClient({
  baseUrl: process.env.OPENAI_BASEURL,
  apiKey: process.env.OPENAI_API_KEY,
});

const getOrder = createTool({
  name: "get_order",
  description: "Read an order summary from local application state.",
  inputSchema: z.object({
    id: z.string().describe("The order id to read."),
  }),
  outputSchema: z.object({
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
  inputSchema: z.object({
    orderId: z.string().describe("The order id to refund."),
    amount: z.number().positive().describe("The refund amount in USD."),
    reason: z.string().describe("The reason to record with the refund."),
  }),
  outputSchema: z.object({
    refundId: z.string(),
    orderId: z.string(),
    amount: z.number(),
    status: z.enum(["issued"]),
  }),
  requiresApproval: ({ amount, orderId }) =>
    amount > 0 ? { reason: `Review refund of $${amount} for order ${orderId}.` } : false,
  execute: ({ orderId, amount }) => ({
    refundId: `rf_${orderId.toLowerCase()}`,
    orderId,
    amount,
    status: "issued" as const,
  }),
});

const cancelOrder = createTool({
  name: "cancel_order",
  description: "Cancel an order before fulfillment. This action requires approval.",
  inputSchema: z.object({
    orderId: z.string().describe("The order id to cancel."),
    reason: z.string().describe("The reason to record with the cancellation."),
  }),
  outputSchema: z.object({
    orderId: z.string(),
    status: z.enum(["cancelled"]),
  }),
  requiresApproval: ({ orderId }) => ({
    reason: `Review cancellation for order ${orderId}.`,
  }),
  execute: ({ orderId }) => ({
    orderId,
    status: "cancelled" as const,
  }),
});

const agentModel = client.completionModel("gpt-5.6-luna");
const agent = new Agent({
  id: "studio-support-operations",
  model: agentModel,
  name: "Studio Support Operations",
  description: "Handles operational order lookups and guarded refund actions.",
  instructions: [
    "Use tools for private order data and refund operations.",
    "Look up an order before issuing a refund or cancellation.",
    "Keep responses short and mention whether the guarded action was issued, cancelled, or denied.",
  ].join("\n"),
  maxTurns: 5,
  tools: [getOrder, issueRefund, cancelOrder],
});

new Studio([agent]).start();
