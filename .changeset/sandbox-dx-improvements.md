---
"@anvia/sandbox": minor
---

Improve developer experience across Docker sandboxes, remote hubs, tools, and CLIs:

- Export provider-neutral `SandboxError`, `SandboxErrorCode`, and `isSandboxError` from both `@anvia/sandbox` and `@anvia/sandbox/remote`, and include redacted Docker stderr snippets plus `docker_unavailable` detection in Docker CLI failures.
- Add `hasImage`, `ensureImage`, `listSandboxes`, and `destroySandbox` to `DockerSandboxClient`, and add `execText` plus workdir-absolute path support to `SandboxRuntime` implementations.
- Allow `createSandboxTools` and `createDockerSandboxTools` to accept a `DockerSandbox` handle directly, default `tools` to all sandbox tools when omitted, and export `sandboxToolRecovery` for `@anvia/durable`.
- Add `onConnect`, `onDisconnect`, `onError`, `capabilities`, `waitForConnection`, `attach`, and `AsyncDisposable` to `RemoteSandboxHub`, `AsyncDisposable` to `SandboxDaemon`, `Disposable` to terminal/tunnel handles, and a `createRelayTicketStore` helper for browser relays.
- Add `--from <dir|manifest>` and `--version` to `anvia-sandbox`, symlink `anvia-sandbox-daemon` onto `PATH` in generated desktop images, skip irrelevant package prompts in the interactive wizard, and add strict flag validation, `--version`, and `ANVIA_SANDBOX_TUNNEL*` environment options to `anvia-sandbox-daemon`.
