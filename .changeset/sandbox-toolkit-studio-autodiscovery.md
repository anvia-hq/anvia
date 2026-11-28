---
"@anvia/core": patch
"@anvia/sandbox": minor
"@anvia/studio": minor
---

Add `sandboxToolkit` and `desktopToolkit` (`Toolkit` factories with full `ToolkitOptions` support and Studio discovery metadata), add `pull?: "never" | "if-missing" | "always"` to `DockerSandboxClient.createSandbox`, make `studioSandbox(...)` support local `DockerSandbox`/`SandboxRuntime` handles in addition to `RemoteSandboxHub`, preserve Studio sandbox metadata through `@anvia/core`'s `createToolkit`, and add automatic sandbox discovery plus opt-in shutdown disposal in `@anvia/studio`.
