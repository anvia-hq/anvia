# @anvia/sandbox

Give agents a workspace where they can run commands and work with files. Docker-backed sandboxes keep execution infrastructure explicit and under your application’s control.

## Installation

```sh
pnpm add @anvia/sandbox @anvia/core
```

## Quick start

Requires Node.js 20.12 or later and an accessible Docker daemon. Pull an image before creating a sandbox.

```ts
import { createDockerSandboxTools, DockerSandboxClient } from "@anvia/sandbox";

const client = new DockerSandboxClient();
await client.pullImage({ image: "node:22-bookworm" });

await using sandbox = await client.createSandbox({
  image: "node:22-bookworm",
  workspace: { type: "ephemeral" },
  network: { mode: "none" },
});

const tools = createDockerSandboxTools({
  sandbox: sandbox.runtime,
  tools: ["exec_command", "read_file", "write_file", "list_files"],
});
// Pass tools to new Agent({ id, model, tools }).
```

## What you get

- Command execution, file access, and managed processes.
- Ephemeral workspaces or caller-owned Docker volumes.
- Explicit networking, resource limits, and command policies.
- Stop/resume lifecycle and automatic disposal.
- Read-only sandbox inspection in Anvia Studio.

`await using` destroys the owned container and ephemeral volume at scope exit. Keep the scope open while agents use its tools. Command policies filter executable names; they do not restrict what an allowed interpreter can execute.

## Learn more

- [Usage guide](https://github.com/anvia-hq/anvia/blob/main/docs/packages/tool-sandbox.md)
- [Anvia](https://github.com/anvia-hq/anvia/blob/main/README.md)
- [Contributing](https://github.com/anvia-hq/anvia/blob/main/CONTRIBUTING.md)
