---
title: "@anvia/react: Examples"
description: "Small examples that show @anvia/react at the package boundary."
section: packages
sidebar:
  group: "@anvia/react"
  order: 4
  label: "Examples"
---
## Minimal chat

```tsx
import { useChat } from "@anvia/react";

export function Chat() {
  const chat = useChat({ endpoint: "http://localhost:8787/api/chat" });

  return <button onClick={() => void chat.send("Hello")}>{chat.status}</button>;
}
```
## Product-shaped transport

```tsx
import { createChatTransport, useChat } from "@anvia/react";

const transport = createChatTransport({
  endpoint: "http://localhost:8787/api/support/chat",
  headers: () => ({ "x-client": "support-console" }),
});

export function SupportChat() {
  return useChat({ transport });
}
```
## Harness shape

```ts
import { describe, expect, it } from "vitest";

describe("@anvia/react integration", () => {
  it("keeps the package boundary injectable", () => {
    expect(true).toBe(true);
  });
});
```
Replace the assertion with a focused check around the package boundary: stream format for server/react, observer registration for logging/tracing, or runtime target registration for Studio.
