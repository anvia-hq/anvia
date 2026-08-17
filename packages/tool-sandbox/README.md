# `@anvia/sandbox`

Docker-backed sandbox ownership and tools for Anvia applications.

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
```

`DockerSandboxClient` performs explicit infrastructure operations. Its constructor performs no I/O,
and `createSandbox()` and `resumeSandbox()` never pull images. `DockerSandbox` owns the container and,
for an ephemeral workspace, its Docker volume. Dispose it asynchronously or call `destroy()`.

`stop()` preserves the container and workspace. `resumeSandbox({ id })` creates a fresh live handle for
that container; workspace files persist, while the in-memory managed-process registry starts empty. A
caller-owned `{ type: "docker-volume", name }` workspace is never deleted by the sandbox.

Networking is explicit. Use `{ mode: "none" }` or `{ mode: "bridge", ports: [...] }`; published ports
bind only to `127.0.0.1`. Runtime methods use object arguments, propagate abort signals, and expose
command and process output as bytes. Tool wrappers decode UTF-8 strictly and return structured values.

Studio does not discover sandboxes through tool metadata. Register a read-only inspector explicitly:

```ts
const studio = new Studio([agent], {
  sandboxes: [
    {
      inspector: sandbox.inspector({ files: true, ports: true, processes: true }),
      agentIds: [agent.id],
      toolNames: tools.map((tool) => tool.name),
    },
  ],
});
```

The `anvia-sandbox create-image` CLI only builds images. It does not create, resume, stop, or destroy
sandboxes.
