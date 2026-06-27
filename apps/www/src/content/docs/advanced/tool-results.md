---
title: Tool results
description: Return text, structured content, errors, and model-readable results.
section: advanced
sidebar:
  group: Tools and action safety
  order: 21
---

Tool results are model-readable messages. They should contain enough information for the next model turn to continue correctly, but not more private data than the model needs.

Core normalizes tool handler output into text or structured tool-result content. The runtime then sends that result back to the model as a tool message.

## Text Results

Return text for simple facts, status, or summaries:

```ts
const checkOrderStatus = createTool({
  name: "check_order_status",
  description: "Check the current status of one order.",
  input: z.object({ orderId: z.string() }),
  output: z.string(),
  async execute({ orderId }) {
    const order = await orders.get(orderId);

    return `Order ${order.id} is ${order.status}.`;
  },
});
```

Text is easy for the model to use, but it is not ideal when your application also needs a structured record. Use an output schema for stable object results.

## Structured Object Results

An output schema validates the handler result:

```ts
const searchOrdersOutput = z.object({
  matches: z.array(
    z.object({
      id: z.string(),
      status: z.string(),
      createdAt: z.string(),
    }),
  ),
});

const searchOrders = createTool({
  name: "search_orders",
  description: "Find recent orders for the current user.",
  input: z.object({ query: z.string() }),
  output: searchOrdersOutput,
  async execute({ query }) {
    return {
      matches: await orders.search({ userId: user.id, query }),
    };
  },
});
```

Core serializes ordinary objects for the model. Keep the object small and purpose-built. Do not return raw database rows.

## Structured Content

Use `ToolOutput.content(...)` when the tool should return structured tool-result content, such as text plus an image:

```ts
import { ToolOutput, createTool } from "@anvia/core/tool";

const renderChart = createTool({
  name: "render_chart",
  description: "Render a chart image for a metric.",
  input: z.object({ metricId: z.string() }),
  async execute({ metricId }) {
    const chart = await charts.render(metricId);

    return ToolOutput.content([
      { type: "text", text: `Rendered chart for ${metricId}.` },
      {
        type: "image",
        data: chart.base64Png,
        mediaType: "image/png",
      },
    ]);
  },
});
```

Only return image content when the selected model and product surface can safely use it. For most operational tools, a concise text or object result is enough.

## Errors As Results

A tool can return a model-readable failure when the failure is expected and safe:

```ts
async execute({ orderId }) {
  const order = await orders.find(orderId);

  if (order === undefined) {
    return "No order was found for that id.";
  }

  return `Order ${order.id} is ${order.status}.`;
}
```

Throw for unexpected failures, broken dependencies, invalid service state, or policy failures. In an agent run, core reports the error to `onToolError` and then returns the error text as a tool result so the model can recover. If the failure must stop the run, cancel from `onToolError` and map the cancellation to a safe product response in your runner.

## Redaction

Do not return private tool data unless the model needs it to produce the answer. Prefer summaries over raw records:

```ts
return {
  accountStatus: account.status,
  openInvoiceCount: invoices.length,
  oldestOpenInvoiceDate: invoices[0]?.createdAt,
};
```

Avoid returning secrets, access tokens, full payment details, internal notes, or unredacted customer data. Apply the same retention and redaction rules to tool results that you apply to application logs.

## Tool Result Events

Agent streams can emit `tool_result` events with:

- `toolName`
- `internalCallId`
- provider `toolCallId` when available
- JSON string arguments
- text result
- optional structured result content

Filter these events before sending them to browser clients. Internal operations views can see more detail than user-facing streams.

## Result Checklist

Before shipping a tool result, check:

- the result is useful for the next model turn
- output schemas reject accidental internal fields
- expected misses are returned as safe text
- unexpected failures are thrown and mapped by the runner
- private fields are redacted before reaching the model
