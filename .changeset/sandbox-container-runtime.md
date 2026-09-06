---
"@anvia/sandbox": patch
---

Add a `containerRuntime` option to `DockerSandboxClient.createSandbox()` for running sandboxes on
alternative Docker runtimes such as gVisor (`runsc`). Creation fails with the new
`runtime_not_found` error code when the runtime is not registered in the daemon, and sandbox
inspectors now expose the active `containerRuntime`.
