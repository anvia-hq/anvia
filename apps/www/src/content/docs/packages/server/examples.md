---
title: "@anvia/server: Examples"
description: "Small examples that show @anvia/server at the package boundary."
section: packages
sidebar:
  group: "@anvia/server"
  order: 4
  label: "Examples"
---
## Minimal route

```ts
import type { UIStreamRequest } from "@anvia/core";
import { createEventStream } from "@anvia/server";

export async function POST(request: Request) {
  const body = (await request.json()) as UIStreamRequest;
  return createEventStream(agent.prompt(body.messages).stream());
}
```
## Product-shaped endpoint

```ts
export async function POST(request: Request) {
  const user = await requireUser(request);
  const body = await parseChatRequest(request);

  return createEventStream(createSupportAgent(user).prompt(body.messages).stream(), {
    format: "jsonl",
  });
}
```
## Harness shape

```ts
import { describe, expect, it } from "vitest";

describe("@anvia/server integration", () => {
  it("keeps the package boundary injectable", () => {
    expect(true).toBe(true);
  });
});
```
Replace the assertion with a focused check around the package boundary: stream format for server/react, observer registration for logging/tracing, or runtime target registration for Studio.
