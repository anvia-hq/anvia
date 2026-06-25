---
title: Use chat history
description: Pass existing conversation messages into an agent request.
section: basics
sidebar:
  group: Capabilities
  order: 1
---

Use chat history when your app already owns the conversation transcript.

## When to use this

Use explicit chat history when messages are already stored in your app and you want to pass a transcript into one request.

This is different from durable agent memory. With chat history, your app supplies the messages every time.

## Pass messages

```ts
import { AgentBuilder, Message } from "@anvia/core";

const agent = new AgentBuilder("assistant", model)
  .instructions("Respect prior conversation context.")
  .build();

const history = [
  Message.user("My project is named Anvia."),
  Message.assistant("Noted. Your project is named Anvia."),
];

const response = await agent
  .prompt([...history, Message.user("What is my project named?")])
  .send();

console.log(response.output);
```

## What happens

The final message is the active prompt. Earlier messages are sent as request history.

Use this when your product already persists messages. Use memory when you want the agent to load and save session messages through a `MemoryStore`.

## Next

Add tools so the agent can call product actions.

[Add tools](/docs/basics/add-tools)
