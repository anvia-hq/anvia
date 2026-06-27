---
title: "@anvia/server: Getting Started"
description: "Install @anvia/server and wire it into an Anvia project."
section: packages
sidebar:
  group: "@anvia/server"
  order: 2
  label: "Getting Started"
---
## Install

```sh
pnpm add @anvia/server
```

## Minimum setup

```ts
import { createEventStream } from "@anvia/server";

export async function POST(request: Request) {
  const { message } = await request.json();

  return createEventStream(agent.prompt(message).stream(), {
    format: "jsonl",
  });
}
```
## Next step

Continue with [Usage Patterns](/docs/packages/server/usage-patterns).
