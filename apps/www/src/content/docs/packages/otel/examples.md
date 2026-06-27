---
title: "@anvia/otel: Examples"
description: "Small examples that show @anvia/otel at the package boundary."
section: packages
sidebar:
  group: "@anvia/otel"
  order: 4
  label: "Examples"
---
## Minimal tracing observer

```ts
import { AgentBuilder } from "@anvia/core";
import { otel } from "@anvia/otel";

const tracing = otel.create({ tracerName: "support-agent" });
const agent = new AgentBuilder("support", model).observe(tracing).build();
```
## Product-shaped setup

```ts
import { NodeSDK } from "@opentelemetry/sdk-node";
import { otel } from "@anvia/otel";

const sdk = new NodeSDK({ serviceName: "support-api" });
sdk.start();

export const tracing = otel.create({ tracerName: "support-api" });
```
## Harness shape

```ts
import { describe, expect, it } from "vitest";

describe("@anvia/otel integration", () => {
  it("keeps the package boundary injectable", () => {
    expect(true).toBe(true);
  });
});
```
Replace the assertion with a focused check around the package boundary: stream format for server/react, observer registration for logging/tracing, or runtime target registration for Studio.
