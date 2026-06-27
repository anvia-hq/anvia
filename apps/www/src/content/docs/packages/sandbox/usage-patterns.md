---
title: "@anvia/sandbox: Usage Patterns"
description: "Common ways to compose @anvia/sandbox with adjacent Anvia packages."
section: packages
sidebar:
  group: "@anvia/sandbox"
  order: 3
  label: "Usage Patterns"
---
## Package boundary

`@anvia/sandbox` owns Docker-backed execution and file tools. Application code owns when the agent is allowed to use those tools, what workspace policy applies, and which operations require approval.

## Common composition

- Pair sandbox tools with `AgentBuilder.tools(...)` or a tool set.
- Pair with tool approvals when commands or file writes need human review.
- Pair with observability packages to record command lifecycle and failures.

## Do and do not

Do set explicit workspace, file-size, timeout, and lifecycle policy. Do keep secrets out of sandbox-visible files unless the task requires them. Do treat command execution as a privileged side effect.

Do not mount broad host paths by default. Do not let model prompts override sandbox policy. Do not use the sandbox as the only production isolation boundary without infrastructure controls.
