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

## Inspect a live sandbox in Studio

Tools returned by `createSandboxTools(...)` carry non-enumerable runtime metadata that lets
`@anvia/studio` recognize their bound session. Attach those tools to a configured Studio agent and
the live session appears automatically in the Sandboxes inspector:

```ts
const session = await DockerSandbox.node().createSession();
const tools = createSandboxTools(session);
const agent = new AgentBuilder("builder", model).tools(tools).build();

new Studio([agent]).start();
```

The integration exposes read-only file browsing and downloads. Published ports, managed
processes, and process logs also appear when the selected sandbox provider implements those
capabilities. Studio deduplicates one session shared by several tools or agents and shows all of
its associations.

The application still owns the sandbox lifecycle. Destroying the session makes it unavailable to
the inspector, and stopping Studio does not destroy it. Studio does not persist sandbox files or
process state.

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

## Live website previews

For a development server such as Vite, pre-authorize its container port when creating the
session. Start the server as a managed process, wait for readiness, and proxy the returned host
binding through an authenticated application route or preview subdomain.

```ts
const sandbox = DockerSandbox.node({
  network: true,
  limits: { maxProcesses: 2 },
});
const session = await sandbox.createSession({ ports: [5173] });

const process = await session.startProcess({
  command: "pnpm",
  args: ["dev", "--", "--host", "0.0.0.0", "--port", "5173"],
});

const target = await session.waitForPort(5173);
// Application proxy target: http://${target.host}:${target.hostPort}
```

The host binding is intentionally loopback-only and has a random port. Do not send that internal
address to a remote browser. The consuming application should translate it into its own authorized
URL and proxy HTTP and WebSocket traffic as needed. Stop the process explicitly when the preview
ends, or destroy the session to clean up the process and port mapping together.

This loopback target assumes the consuming application runs on the Docker host. An application in
another container cannot reach the Docker host through its own `127.0.0.1`; use a host-side proxy
for this version of the feature.

To let an agent own this flow, opt into `list_ports`, `start_process`, `list_processes`,
`read_process_logs`, `wait_for_port`, and `stop_process` when calling `createSandboxTools(...)`.
The process command is supplied programmatically by the agent and remains subject to the existing
allowed and blocked executable policy.

## Do and do not

Do set explicit workspace, file-size, timeout, and lifecycle policy. Do keep secrets out of
sandbox-visible files unless the task requires them. Do treat command execution as a privileged
side effect.

Do not mount broad host paths by default. Do not let model prompts override sandbox policy. Do not
expose arbitrary sandbox paths as static files. Do not use the sandbox as the only production
isolation boundary without infrastructure controls.
