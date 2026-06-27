---
title: "@anvia/logger: Usage Patterns"
description: "Common ways to compose @anvia/logger with adjacent Anvia packages."
section: packages
sidebar:
  group: "@anvia/logger"
  order: 3
  label: "Usage Patterns"
---
## Package boundary

`@anvia/logger` owns structured conversion from Anvia observer events to logger calls. Application code owns which logger is used, which payloads can be recorded, and how logs are shipped.

## Common composition

- Use `createConsoleLogger(...)` for local development.
- Use `createPinoLogger(...)` when the application already uses Pino-compatible logging.
- Attach `createLoggerObserver(...)` through `AgentBuilder.observe(...)`.

## Do and do not

Do leave sensitive payload logging disabled unless data policy allows it. Do include request and tenant context through logger metadata. Do combine logs with tracing for production investigations.

Do not rely on logs as the only audit trail for tool side effects. Do not write raw provider requests in shared environments unless redaction is in place.
