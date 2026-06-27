---
title: Tool middleware
description: Intercept completion requests, tool input, and tool output.
section: advanced
sidebar:
  group: Tools and action safety
  order: 22
---

Middleware transforms runtime data without changing the core tool contract. Use it for instrumentation, normalization, request shaping, large-result spillover, and safe output filtering.

Use hooks when you need to decide whether a run continues. Use middleware when you need to transform requests or results.

## Create Middleware

```ts
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createMiddleware } from "@anvia/core";

const TOOL_OUTPUT_LIMIT = 4_000;
const toolOutputDir = "/var/app/tool-outputs";

const spillLargeToolOutput = createMiddleware({
  async onToolOutput({ toolName, internalCallId, result }) {
    if (result.length <= TOOL_OUTPUT_LIMIT) {
      return;
    }

    await mkdir(toolOutputDir, { recursive: true });
    const filename = `${toolName}-${internalCallId}.txt`;
    const path = join(toolOutputDir, filename);
    await writeFile(path, result, "utf8");

    return {
      result: `Tool output was ${result.length} characters and was written to ${path}.`,
    };
  },
});
```

Attach middleware to the agent when it should apply to every run:

```ts
const agent = new AgentBuilder("support", model)
  .middleware(spillLargeToolOutput)
  .build();
```

Attach middleware to one request when it is request-specific:

```ts
const session = agent.session(threadId, { userId: user.id });
const request = session.prompt(message).withMiddleware(spillLargeToolOutput);
const response = await request.send();
```

## Middleware Points

`AgentMiddleware` can implement:

- `onCompletionRequest` to replace the provider-neutral completion request before the model call
- `onCompletionResponse` to replace the completion response before the runtime continues
- `onToolInput` to replace tool arguments before the tool handler is called
- `onToolOutput` to replace text or structured tool output before it is sent back to the model

Agent-level middleware runs before request-level middleware because the runtime combines agent middleware first, then request middleware.

## Tool Input Middleware

Use tool input middleware sparingly. It runs after approvals and before the handler:

```ts
const normalizeOrderIds = createMiddleware({
  onToolInput({ toolName, args }) {
    if (toolName !== "get_order") {
      return;
    }

    const parsed = JSON.parse(args);

    return {
      args: {
        ...parsed,
        orderId: String(parsed.orderId).trim(),
      },
    };
  },
});
```

Do not use middleware to bypass schema validation or permission checks. Tool handlers must still validate the operation.

## Tool Output Middleware

`onToolOutput` can return replacement text:

```ts
const hideInternalErrors = createMiddleware({
  onToolOutput({ result }) {
    if (!result.includes("INTERNAL_")) {
      return;
    }

    return "The tool returned an internal service error.";
  },
});
```

Or it can return structured content:

```ts
const addToolFooter = createMiddleware({
  onToolOutput({ result }) {
    return {
      structuredResult: [
        { type: "text", text: result },
        { type: "text", text: "Source: internal support tools" },
      ],
    };
  },
});
```

When structured output is returned, core also derives the text result from that structured content for stream events and observers.

## Completion Middleware

Completion middleware sees the model request or response for each turn:

```ts
const requireSmallResponses = createMiddleware({
  onCompletionRequest({ request }) {
    return {
      request: {
        ...request,
        maxTokens: Math.min(request.maxTokens ?? 600, 600),
      },
    };
  },
});
```

Use this for cross-cutting request policy. Avoid large hidden prompt rewrites; stable behavior belongs in instructions, tools, or the runner.

## Deprecations

Use `createMiddleware`, `.middleware(...)`, `.middlewares(...)`, `.withMiddleware(...)`, and `onToolOutput`.

Older names such as `createToolMiddleware`, `.toolMiddleware(...)`, `.toolMiddlewares(...)`, `.withToolMiddleware(...)`, and `onResult` are still present for compatibility, but new docs and application code should use the middleware names.

## Middleware Checklist

Before adding middleware, check:

- the behavior is truly cross-cutting
- the transformation is deterministic and testable
- tool handlers still enforce permissions
- private data is redacted before browser streams
- the same logic does not belong more clearly in a tool, hook, or runner
