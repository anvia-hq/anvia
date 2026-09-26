---
"@anvia/sandbox": patch
---

Keep sandbox secrets out of Docker error messages. `assertDockerCli` builds its failure
message from the Docker argv, and `createSandbox()` passes sandbox `env` values as
`--env KEY=VALUE` arguments, so a failed `docker run` used to throw a
`DockerSandboxError` whose message contained every environment value in cleartext. Those
messages are routinely logged, traced, and shown to agents. The message now redacts the
value after the `KEY=` prefix (for example `--env OPENAI_API_KEY=<redacted>`) while
keeping the variable name and the rest of the command readable. The same redaction covers
`-e KEY=VALUE` so the helper stays safe if other callers adopt it.
