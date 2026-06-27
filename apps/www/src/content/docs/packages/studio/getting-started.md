---
title: "@anvia/studio: Getting Started"
description: "Install @anvia/studio and wire it into an Anvia project."
section: packages
sidebar:
  group: "@anvia/studio"
  order: 2
  label: "Getting Started"
---
## Install

```sh
pnpm add @anvia/studio @anvia/core
```

## Minimum setup

```ts
import { AgentBuilder } from "@anvia/core";
import { Studio } from "@anvia/studio";

const agent = new AgentBuilder("support", model)
  .name("Support")
  .description("Answers support questions.")
  .instructions("Answer support questions clearly.")
  .build();

new Studio([agent]).start({
  port: 4021,
});
```
## Next step

Continue with [Usage Patterns](/docs/packages/studio/usage-patterns).
