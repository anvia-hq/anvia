---
"@anvia/sandbox": minor
---

Add a provider-neutral `SandboxRuntime` interface and `createSandboxTools`. `DockerSandboxRuntime`
now extends `SandboxRuntime`, and `createDockerSandboxTools` wraps `createSandboxTools` with
identical tool names, schemas, policies, and outputs. Neutral `Sandbox*` option and policy types
are exported; the `DockerSandbox*` names remain as aliases.
