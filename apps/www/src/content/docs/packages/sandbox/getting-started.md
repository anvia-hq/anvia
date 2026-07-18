---
title: "@anvia/sandbox: Getting Started"
description: "Install @anvia/sandbox and wire it into an Anvia project."
section: packages
sidebar:
  group: "@anvia/sandbox"
  order: 2
  label: "Getting Started"
---
## Install

```sh
pnpm add @anvia/sandbox @anvia/core
```

## Create a custom image

Run the interactive image builder to select Node.js, Bun, Python, reporting tools, or Playwright:

```sh
pnpm dlx @anvia/sandbox create-image
```

For scripts and CI, provide the image name and capabilities as flags:

```sh
pnpm dlx @anvia/sandbox create-image \
  --name reports \
  --runtime bun \
  --feature artifacts \
  --feature playwright
```

The command saves the build context under `.anvia/sandbox-images/reports`, builds the local image,
and prints the `DockerSandbox` constructor configuration. Pass `--no-build` to generate the source
without invoking Docker, or add repeatable `--apt`, `--npm`, and `--uv` flags for extra packages.
The wizard offers common apt, npm, and Python packages as checkboxes. Python dependencies are
managed in a generated `pyproject.toml` and installed into the image with `uv sync`.

The `artifacts` feature includes Matplotlib, Seaborn, Pillow, ReportLab, pypdf, pandas, openpyxl,
XlsxWriter, and python-docx. The `playwright` feature installs Chromium and automatically adds
Node.js. It is intended for local development and testing; do not treat a root-run browser as a
strong security boundary for untrusted websites.

## Minimum setup

```ts
import { AgentBuilder } from "@anvia/core";
import { DockerSandbox, createSandboxTools } from "@anvia/sandbox";

const sandbox = DockerSandbox.node({
  network: false,
});
const session = await sandbox.createSession({
  id: "support-debug",
});

const sandboxTools = createSandboxTools(session, {
  exec: {
    maxTimeoutMs: 30_000,
  },
});

const agent = new AgentBuilder("debugger", model)
  .instructions("Inspect files only inside the sandbox workspace.")
  .tools(sandboxTools)
  .defaultMaxTurns(8)
  .build();
```
## Next step

Continue with [Usage Patterns](/docs/packages/sandbox/usage-patterns).
