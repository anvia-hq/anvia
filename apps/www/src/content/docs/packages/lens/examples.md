---
title: "@anvia/lens: Examples"
description: "Native Anvia Lens tracing and evaluation examples."
section: packages
sidebar:
  group: "@anvia/lens"
  order: 4
  label: "Examples"
---
## Explicit configuration

Explicit options override environment variables:

```ts
import { lens } from "@anvia/lens";

const tracing = lens.create({
  baseUrl: "https://lens.example.com",
  publicKey: process.env.LENS_PROJECT_PUBLIC_KEY,
  secretKey: process.env.LENS_PROJECT_SECRET_KEY,
  serviceName: "checkout-agent",
  environment: "production",
  release: process.env.APP_RELEASE,
});
```

## Custom redaction

```ts
const tracing = lens.create({
  captureMode: "full",
  redaction: {
    patterns: [{ name: "customer-id", regex: /cust_[a-z0-9]+/gi }],
    replacement: "[PRIVATE]",
  },
});
```
