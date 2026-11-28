# @anvia/sandbox

Give agents a workspace where they can run commands, work with files, manage processes, and drive a virtual desktop. Run sandboxes locally with Docker or remotely over an outbound WebSocket daemon.

## Installation

```sh
pnpm add @anvia/sandbox @anvia/core
```

## Quick start

Requires Node.js 20.12 or later and an accessible Docker daemon.

```ts
import { Agent } from "@anvia/core/agent";
import { DockerSandboxClient, sandboxToolkit } from "@anvia/sandbox";

const client = new DockerSandboxClient();

await using sandbox = await client.createSandbox({
  image: "node:22-bookworm",
  pull: "if-missing",
  workspace: { type: "ephemeral" },
  network: { mode: "none" },
});

const agent = new Agent({
  id: "sandbox-coder",
  model,
  tools: [
    sandboxToolkit({
      sandbox,
      include: ["exec_command", "read_file", "write_file", "list_files"],
      requiresApproval: { exec_command: true },
    }),
  ],
});
```

With `@anvia/studio`, sandboxes attached via `sandboxToolkit(...)` or `desktopToolkit(...)` are discovered automatically (`new Studio([agent])`) — or pass explicit `studioSandbox(sandbox)` / `studioSandbox(hub, sandboxId)` registrations when customizing capabilities.

## What you get

- **Docker sandboxes (`@anvia/sandbox`)**: `DockerSandboxClient` (`hasImage`, `ensureImage`, `pullImage`, `createSandbox` with `pull: "never" | "if-missing" | "always"`, `resumeSandbox`, `listSandboxes`, `destroySandbox`), ephemeral workspaces or caller-owned Docker volumes, explicit networking, resource limits, command policies, stop/resume lifecycle, and `await using` disposal.
- **Agent toolkits & tools (`@anvia/sandbox`)**: `sandboxToolkit` and `desktopToolkit` (full `@anvia/core` `ToolkitOptions` support + Studio auto-discovery), lower-level `createSandboxTools` (with `sandboxToolRecovery` for `@anvia/durable`) and `createDesktopTools` (with `desktopToolRecovery`), polymorphic `studioSandbox`, plus `SandboxError` and `isSandboxError` helpers.
- **Remote sandboxes (`@anvia/sandbox/remote`, `@anvia/sandbox/daemon`)**: `RemoteSandboxHub` (with `onConnect`/`onDisconnect`/`onError`, `waitForConnection`, `capabilities`, `attach`, and `createRelayTicketStore`), `SandboxDaemon`, interactive terminals, TCP tunnels, virtual desktops, and Studio integration via `studioSandbox`.
- **CLIs**: `anvia-sandbox create-image` (including `--from <dir|manifest>`) for generating Dockerfiles, and `anvia-sandbox-daemon` (`--check`, `--require`, `--version`) for remote sandbox containers.

`await using` destroys the owned container and ephemeral volume at scope exit. Keep the scope open while agents use its tools. Command policies filter executable names; they do not restrict what an allowed interpreter can execute.

File writes reject symlinks in the destination and all parent path components with `invalid_path`, checking before directory creation and before copying. These checks require `sh` in the image and are separate from the copy; they do not provide atomic protection against concurrent link swaps.

## Shell command lines

`exec_command` and `start_process` use `/bin/bash -c` for natural command lines when `/bin/bash` is executable, falling back to `sh -c` when it is absent. Availability is cached per live sandbox runtime handle. Explicit `command` plus `args` remains exact argv; use `{ command: "sh", args: ["-c", script] }` to retain POSIX shell behavior.

Allow policies must permit the selected executable (`/bin/bash` or `sh`) and set `allowShellInterpreters: true`. Allowing only `sh` does not implicitly authorize Bash. Block-mode policies continue to reject natural command lines. See the usage guide for details.

## Learn more

- [Usage guide](https://github.com/anvia-hq/anvia/blob/main/docs/packages/tool-sandbox.md)
- [Anvia](https://github.com/anvia-hq/anvia/blob/main/README.md)
- [Contributing](https://github.com/anvia-hq/anvia/blob/main/CONTRIBUTING.md)
