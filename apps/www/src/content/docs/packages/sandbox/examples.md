---
title: "@anvia/sandbox: Examples"
description: "Small examples that show @anvia/sandbox at the package boundary."
section: packages
sidebar:
  group: "@anvia/sandbox"
  order: 4
  label: "Examples"
---
## Minimal sandbox tools

```ts
import { AgentBuilder } from "@anvia/core";
import { DockerSandbox, createSandboxTools } from "@anvia/sandbox";

const sandbox = DockerSandbox.node({ network: false });
const session = await sandbox.createSession({ id: "demo" });
const tools = createSandboxTools(session);

const agent = new AgentBuilder("workspace-agent", model).tools(tools).build();
```
## Product-shaped approval boundary

```ts
const sandbox = DockerSandbox.node({
  network: false,
  limits: { timeoutMs: 30_000, maxOutputBytes: 64_000 },
});
const session = await sandbox.createSession({
  id: request.id,
  workspace: { mode: "persistent", id: request.id },
});

const agent = new AgentBuilder("debugger", model)
  .instructions("Inspect the sandbox and propose changes before writing files.")
  .tools(
    createSandboxTools(session, {
      include: ["exec_command", "read_file", "list_files"],
      exec: { allowedCommands: ["node", "pnpm", "ls", "cat"] },
      readFile: { maxBytes: 64_000 },
    }),
  )
  .approvals({
    handler: async (approval) => {
      return {
        approved: await reviewSandboxAction(approval),
        reason: "Reviewed before sandbox execution.",
      };
    },
  })
  .build();
```

## Serve a generated artifact

Use `session.readFile(...)` from application code when a sandbox command produces an image or
another binary artifact. Keep the public route narrow and copy artifacts to durable storage before
destroying the session if the URL needs to outlive the sandbox.

```ts
import type { SandboxSession } from "@anvia/sandbox";

export async function serveSandboxArtifact(
  session: SandboxSession,
  requestedPath: string,
): Promise<Response> {
  const artifactPath = normalizeArtifactPath(requestedPath);

  if (artifactPath === undefined || !artifactPath.startsWith("artifacts/")) {
    return new Response("Not found", { status: 404 });
  }

  const contentType = imageContentType(artifactPath);

  if (contentType === undefined) {
    return new Response("Unsupported artifact type", { status: 415 });
  }

  const bytes = await session.readFile(artifactPath);

  return new Response(bytes, {
    headers: {
      "cache-control": "private, max-age=60",
      "content-type": contentType,
    },
  });
}

function normalizeArtifactPath(path: string): string | undefined {
  const parts = path.split(/[\\/]+/).filter(Boolean);

  if (parts.some((part) => part === "." || part === "..")) {
    return undefined;
  }

  return parts.join("/");
}

function imageContentType(path: string): string | undefined {
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  if (path.endsWith(".webp")) return "image/webp";
  if (path.endsWith(".gif")) return "image/gif";
  return undefined;
}
```

## Harness shape

```ts
import { describe, expect, it } from "vitest";

describe("@anvia/sandbox integration", () => {
  it("keeps the package boundary injectable", () => {
    expect(true).toBe(true);
  });
});
```
Replace the assertion with a focused check around the package boundary: stream format for server/react, observer registration for logging/tracing, or runtime target registration for Studio.
