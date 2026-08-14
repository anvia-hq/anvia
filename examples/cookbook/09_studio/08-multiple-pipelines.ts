import { Pipeline } from "@anvia/core/pipeline";
import { Studio } from "@anvia/studio";
import { z } from "zod";

type OrderSnapshot = {
  id: string;
  status: "processing" | "blocked" | "shipped" | "unknown";
  customer: string;
  notes: string;
};

const orders: Record<string, OrderSnapshot> = {
  "11001": {
    id: "11001",
    status: "blocked",
    customer: "Delta Kit Labs",
    notes: "Payment review is complete, but warehouse allocation has not been confirmed.",
  },
  "11002": {
    id: "11002",
    status: "processing",
    customer: "Northwind Labs",
    notes: "Picking is queued for the next warehouse wave.",
  },
  "11003": {
    id: "11003",
    status: "shipped",
    customer: "Aster Supply",
    notes: "Carrier pickup completed and tracking is active.",
  },
};

const orderStatusPipeline = new Pipeline({
  id: "order-status-pipeline",
  inputSchema: z.string(),
  name: "Order Status Pipeline",
  description:
    "Normalizes an order lookup, reads local order state, and returns an operator summary.",
  metadata: {
    owner: "support-operations",
    sampleInput: "ORDER 11001",
  },
})
  .step((raw) => raw.trim().replace(/^order\s+/i, ""), {
    name: "Normalize Order Id",
    description: "Accept either a bare order id or input like ORDER 11001.",
  })
  .step(
    (orderId): OrderSnapshot =>
      orders[orderId] ?? {
        id: orderId,
        status: "unknown",
        customer: "Unknown",
        notes: "No local order snapshot was found for this id.",
      },
    {
      name: "Read Order Snapshot",
      description: "Look up the order in local application state.",
    },
  )
  .step(
    (order) => ({
      title: `Order ${order.id}`,
      status: order.status,
      customer: order.customer,
      nextAction:
        order.status === "blocked"
          ? "Ask warehouse operations to confirm allocation."
          : order.status === "processing"
            ? "Monitor the next warehouse wave."
            : order.status === "shipped"
              ? "Share the active tracking status with the customer."
              : "Ask the customer to verify the order id.",
      notes: order.notes,
    }),
    {
      name: "Build Operator Summary",
      description: "Return a compact result object for Studio inspection.",
    },
  );

const ticketRoutingPipeline = new Pipeline({
  id: "ticket-routing-pipeline",
  inputSchema: z.string(),
  name: "Ticket Routing Pipeline",
  description: "Classifies a pasted support ticket and recommends an operational route.",
  metadata: {
    owner: "support-operations",
    sampleInput: "Enterprise customer reports checkout outage after payment retries failed.",
  },
})
  .step((ticket) => ticket.trim(), {
    name: "Normalize Ticket",
    description: "Trim pasted ticket text before deterministic branch analysis.",
  })
  .parallel(
    {
      classification: new Pipeline({
        id: "ticket-classification",
        inputSchema: z.string(),
      }).step((ticket) => ({
        topic: ticket.toLowerCase().includes("payment") ? "billing" : "operations",
      })),
      priority: new Pipeline({ id: "ticket-priority", inputSchema: z.string() }).step((ticket) => ({
        priority:
          ticket.toLowerCase().includes("outage") ||
          ticket.toLowerCase().includes("enterprise") ||
          ticket.toLowerCase().includes("blocked")
            ? "high"
            : "normal",
      })),
      routing: new Pipeline({ id: "ticket-routing", inputSchema: z.string() }).step((ticket) => ({
        team: ticket.toLowerCase().includes("payment") ? "billing-ops" : "support-ops",
      })),
    },
    {
      name: "Analyze Ticket",
      description: "Run independent deterministic classifiers in parallel.",
    },
  )
  .step(
    ({ classification, priority, routing }) => ({
      topic: classification.topic,
      priority: priority.priority,
      team: routing.team,
      handoffRequired: priority.priority === "high",
      nextAction:
        priority.priority === "high"
          ? `Escalate to ${routing.team} with the incident context.`
          : `Queue for ${routing.team} review.`,
    }),
    {
      name: "Build Routing Decision",
      description: "Merge branch outputs into one routing object.",
    },
  );

new Studio([orderStatusPipeline, ticketRoutingPipeline]).start();
