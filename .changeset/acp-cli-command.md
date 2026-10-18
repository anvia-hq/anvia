---
"@anvia/cli": minor
"@anvia/acp": minor
---

Add `anvia acp --agent ./agent.ts` with an optional ACP runtime peer and document Zed setup.
Expose the shared process-owned `@anvia/acp/launcher` entrypoint, improve safe module diagnostics,
and await session and MCP cleanup on shutdown in both launchers. TypeScript uses Node's native
type stripping, with guidance to compile JavaScript on unsupported runtimes.
The ACP runtime requires Node 22.19.0+ to support its MCP transport dependency.
