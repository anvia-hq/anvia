# Inspectors

Debug in this order: playground → traces → approvals → sessions. Each surface
answers a different question.

- **Playground** — chat with a registered agent or team, switch models per run
  (Studio can expose a shared multi-provider catalog with per-agent allow
  lists), restore control choices from session metadata. First stop for
  "what does it do?".
- **Trace browser + session logs** — what actually happened: messages, tool
  activity, usage, realtime log stream. First stop for "why did it do that?".
- **Tool approval workflows** — exercise `requiresApproval` tools and question
  prompts end to end; approvals resolve through the same interaction responses
  the API uses.
- **Eval suite runner** — run registered `runEvalSuite` configurations from the
  UI. Keep the suite definitions in code (see the `anvia-evals` skill); Studio
  runs them, it does not own them.
- **Direct tool + MCP inspectors** — invoke tools by hand, including MCP tools.
  Studio reads MCP provenance from `Agent.mcpServers`, so `McpClient`
  `tools.prefix` values stay visible here.
- **Memory explorer** — users, conversations, messages, transcript steps from
  the session store. Empty here plus working chat means the store is not the
  one the agent writes to — check `stores.sessions`.
- **Pipelines** — graph, logs, run history, replay-from-history.
- **Knowledge** — static/dynamic context, dynamic tools, retrieval log. First
  stop for "why didn't it retrieve?".
- **Status dashboard** — storage adapters, record counts, enabled capabilities.
  First stop for "is anything even configured?".
- **Graphs** — bounded overview/expansion over registered `GraphExplorer`
  graphs (`@anvia/neo4j`, `@anvia/memgraph`); no raw queries accepted.

Sandbox/browser registrations add loopback-only noVNC desktop views with explicit
takeover leases — local debugging conveniences, not an auth model.
