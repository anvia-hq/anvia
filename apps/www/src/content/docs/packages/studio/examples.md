---
title: "@anvia/studio: Examples"
description: "Small examples that show @anvia/studio at the package boundary."
section: packages
sidebar:
  group: "@anvia/studio"
  order: 4
  label: "Examples"
---
## Minimal Studio server

```ts
import { Studio } from "@anvia/studio";

new Studio([agent]).start({ port: 4021 });
```
## Product-shaped local runtime

```ts
import { Studio, createSqliteSessionStore } from "@anvia/studio";

new Studio([supportAgent, triagePipeline], {
  stores: {
    sessions: createSqliteSessionStore({ path: ".anvia/studio.sqlite" }),
  },
}).start({ port: Number(process.env.RUNNER_PORT ?? 4021) });
```
## Harness shape

```ts
import { describe, expect, it } from "vitest";

describe("@anvia/studio integration", () => {
  it("keeps the package boundary injectable", () => {
    expect(true).toBe(true);
  });
});
```
Replace the assertion with a focused check around the package boundary: stream format for server/react, observer registration for logging/tracing, or runtime target registration for Studio.
