---
"@anvia/sandbox": patch
---

`studioSandbox(hub, sandboxId, { agentIds, toolNames })` from `@anvia/sandbox/remote` returns what Studio's `sandboxes` option takes for a remote sandbox: an inspector for its files, processes and logs, and a live desktop view that a person can watch and take over. Taking control pauses the agent's desktop tools, and the person's input reaches the desktop only while they hold it. `studioDesktopView(desktop)` gives just the view. Studio and the hub must run in the same process.
