# Skills

Agent Skills for Anvia. Each skill is one `SKILL.md` entrypoint plus lazily
loaded `references/` and executable `scripts/`, following the contract in
`packages/core/src/skills/` (`name` matches the directory, `description` routes).

Load them with:

```ts
import { loadSkills, skill } from "@anvia/core/skills";

const skills = await loadSkills(skill.local("./skills"));
```

| Skill            | When to use                                                                                    |
| ---------------- | ---------------------------------------------------------------------------------------------- |
| `anvia-agent`    | Build agents and tools — options, approvals, memory, streaming, teams, providers               |
| `anvia-chat`     | Wire chat UI end to end — server route, transport, React hook, UI primitives                   |
| `anvia-channels` | Chat platforms — run agents on Discord/Slack/Telegram, proactive delivery, sessions, streaming |
| `anvia-mcp`      | Connect MCP servers — clients, transports, tool discovery, URL safety                          |
| `anvia-pipeline` | Deterministic multi-step work — steps, composition, parallel, batch, agent stages              |
| `anvia-rag`      | Retrieval over your data — chunking, embeddings, vector stores, knowledge graphs, search tools |
| `anvia-studio`   | Run and inspect agents — serving, playground, traces, approvals, observability                 |
| `anvia-evals`    | Measure quality — deterministic metrics, LLM judges, RAG checks, CI runs                       |
| `release-notes`  | Demo skill — draft release notes (generic example, not Anvia-specific)                         |

This folder is bundled into `@anvia/cli` at build time; `pnpm dlx @anvia/cli skills init`
copies it into an app.
