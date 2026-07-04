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

## Generated artifacts

When a sandbox command produces images, reports, or other binary files, keep the model-facing
tools and the application-facing artifact flow separate. `createSandboxTools(...)` exposes
text-oriented `read_file` and `write_file` tools for the agent. Application code should read
binary artifacts directly from the live `SandboxSession` with `session.readFile(...)`.

Use a predictable artifact directory and serve only files that your application explicitly
allows:

1. Have the agent or command write generated files under a directory such as `artifacts/`.
2. List or track the generated paths from application code.
3. Validate the requested path, prefix, extension, user, and run before reading bytes.
4. Read bytes with `session.readFile("artifacts/image.png")`.
5. Return a short-lived preview response, or copy the bytes to durable storage for public URLs.

Do not treat the sandbox as a static asset server. Ephemeral workspaces are removed when the
session is destroyed, so long-lived links should point to host storage, object storage, or another
artifact store that your application owns.

## Do and do not

Do set explicit workspace, file-size, timeout, and lifecycle policy. Do keep secrets out of
sandbox-visible files unless the task requires them. Do treat command execution as a privileged
side effect.

Do not mount broad host paths by default. Do not let model prompts override sandbox policy. Do not
expose arbitrary sandbox paths as static files. Do not use the sandbox as the only production
isolation boundary without infrastructure controls.
