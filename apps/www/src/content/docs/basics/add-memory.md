---
title: Add memory
description: Persist conversation state and run agents against durable sessions.
section: basics
sidebar:
  group: Capabilities
  order: 3
---

Memory lets an agent load and save messages for a durable session.

## When to use this

Use memory when you want the agent to remember previous messages by `sessionId`. If your app already passes the full transcript into every request, use chat history instead.

## Create a memory store

```ts
import { AgentBuilder, type MemoryStore, type Message } from "@anvia/core";
import type { MemoryAppendInput, MemoryContext } from "@anvia/core/memory";

class LocalMemoryStore implements MemoryStore {
  private readonly sessions = new Map<string, Message[]>();

  async load(context: MemoryContext): Promise<Message[]> {
    return [...(this.sessions.get(context.sessionId) ?? [])];
  }

  async append(input: MemoryAppendInput): Promise<void> {
    const current = this.sessions.get(input.context.sessionId) ?? [];
    this.sessions.set(input.context.sessionId, [...current, ...input.messages]);
  }

  async clear(context: MemoryContext): Promise<void> {
    this.sessions.delete(context.sessionId);
  }
}
```

## Use a session

```ts
const memory = new LocalMemoryStore();

const agent = new AgentBuilder("assistant", model)
  .instructions("Remember durable session context.")
  .memory(memory)
  .build();

const session = agent.session("thread_123", { userId: "user_456" });

await session.prompt("Remember that my project is named Anvia.").send();
const response = await session.prompt("What is my project named?").send();

console.log(response.output);
```

## What happens

The session loads prior messages before the run and appends new messages as the run completes. Memory defaults to `savePolicy: "message"`.

## Next

Add static context to every request.

[Add context](/docs/basics/add-context)
