# ACP 10 editor smoke verification

ACP 14 changes the launch default: the dedicated bin rejects client stdio MCP. MCP smoke tests
now use `fixtures/smoke-host.mjs`, with explicit executable/argv/env approval. The earlier manual
MCP setup below needs an equivalently approved library host; it cannot grant launch authority
through an editor declaration. No new GUI verification was run for ACP 14.

Status: **automated sample checks pass; real-editor acceptance remains open**.
This records repository verification, not a claim of compatibility certification.

## Recorded environment and results

Run date: 2026-10-17. Host: macOS / arm64, Node 26.9.0, pnpm 11.0.4,
ACP SDK 1.9.0, protocol v1. The sample is
[`editor-smoke-agent.mjs`](../examples/editor-smoke-agent.mjs), launched by the built
`dist/cli.js` (the `anvia-acp` bin target). No provider account or network model is used.

`pnpm --filter @anvia/acp test:editors` passed **20 tests in two files**:
`editor-smoke.test.ts` and `launcher.test.ts`. The raw fixture client checks every stdout
frame and exactly one settlement per request, including shutdown. These tests exercise the
same sample and MCP server supplied for manual editor checks, not editor-specific client mocks.

Final repository checks: `pnpm --filter @anvia/acp typecheck`,
`pnpm --filter @anvia/acp test` (241 tests across 16 files), `pnpm check`, and
`pnpm releases:validate` passed. `pnpm format` was applied without unrelated file changes.
The upstream TCK was not rerun because the adapter runtime is unchanged; its ACP 09 result remains
in [CONFORMANCE.md](./CONFORMANCE.md). The agent skill's heuristic checker found no source agent
code (it does not scan `.mjs` examples); the subprocess tests provide sample execution coverage.

| Feature                                                 | Raw stdio fixture             | Zed                                                              | JetBrains AI Assistant       | Neovim / CodeCompanion     |
| ------------------------------------------------------- | ----------------------------- | ---------------------------------------------------------------- | ---------------------------- | -------------------------- |
| Multi-turn chat and isolated sessions                   | Pass                          | Not run                                                          | Not run                      | Not run                    |
| Incremental text before final response                  | Pass                          | Not run                                                          | Not run                      | Not run                    |
| Tool call/status and distinct call IDs                  | Pass                          | Not run                                                          | Not run                      | Not run                    |
| Allow once / reject once, execution count               | Pass                          | Not run                                                          | Not run                      | Not run                    |
| Cancel generation and pending permission                | Pass                          | Not run                                                          | Not run                      | Not run                    |
| Late approval cannot execute cancelled tool             | Pass                          | Not run                                                          | Not run                      | Not run                    |
| Forwarded stdio MCP, denial and execution               | Pass                          | Not run                                                          | Not run                      | Not run                    |
| Startup/config errors and simulated missing credentials | Pass at process/wire boundary | Not run                                                          | Not run                      | Not run                    |
| Exit / protocol-only stdout                             | Pass                          | Not run                                                          | Not run                      | Not run                    |
| Installed editor version                                | Not applicable                | 1.24.2 (`zed --version`)                                         | Not found in `/Applications` | `nvim` unavailable on PATH |
| Verification blocker                                    | None                          | Computer Use returned “Computer Use was not approved to use Zed” | IDE/plugin unavailable       | Editor/plugin unavailable  |

No screenshots or real-editor traces were captured. Zed's version output establishes installation
only. No editor settings were modified. The raw fixture is **not** the independent client required
for acceptance; Zed plus JetBrains or Neovim must still complete the checklist below.

### Capability boundaries and known gaps

| Surface                       | Dedicated bin / smoke sample                                                        | Editor implications                                                                                                          |
| ----------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Authentication                | `authMethods: []`; `authenticate` succeeds without work                             | No ACP login UI is expected. Real model credentials belong to the application factory.                                       |
| Sessions                      | In-memory, session factory creates a fresh agent                                    | New chats reset counters. Load/resume/list are not advertised; history restoration is ACP 11.                                |
| Approvals                     | Only allow once and reject once                                                     | Test both choices; there is no always-allow cache.                                                                           |
| MCP                           | Stdio supported; HTTP disabled by default; SSE unsupported                          | Forward only the smoke stdio server. Private HTTP / integrated IDE MCP may require an explicitly configured library host.    |
| Editor filesystem / terminals | Off by default                                                                      | These configs do not test unsaved buffers or editor terminal callbacks. Existing ACP 08/09 tests cover opt-in library hosts. |
| Model/config UI               | Default `ask` config; no model catalog                                              | Empty model selection or no alternative mode is expected for this sample.                                                    |
| Error presentation            | Fixed startup stderr; factory failure is `-32603`, `data.kind: configuration_error` | Editor display of stderr remains unverified. Generic wire errors alone do not identify a missing provider key.               |
| Sample                        | Deterministic text model, in-memory local counter and dedicated MCP ping            | Proves adapter behavior, not real-provider authentication, latency, reasoning, media, or coding quality.                     |

The sample's missing-config and missing-credentials switches are **simulations**, not an attempt to
authenticate to a provider. Its fixed stderr diagnostics explain recovery without logging a key or
underlying exception. Applications must supply their own safe, actionable configuration diagnostics.

## Reproduce automated checks and prepare editor configs

Run from the repository root after installing workspace dependencies:

```sh
pnpm --filter @anvia/core build
pnpm --filter @anvia/acp test:editors
node packages/acp/examples/write-editor-configs.mjs /tmp/anvia-acp-editor-configs
```

Choose a new output directory: the generator refuses an existing directory. It writes reviewable
Zed JSON, JetBrains ACP/MCP JSON and CodeCompanion Lua with absolute Node, launcher, agent and MCP
paths, including correct argument boundaries for paths with spaces. It does not install plugins,
modify editor settings, set credentials, or launch editors. Keep the checkout in place for the run.
These snippets are repository-only examples and are not included in the npm package.

Use a disposable workspace with no private content. Merge the named entries into editor settings;
preserve existing settings. Forward only `anvia-smoke` during this test: ACP session setup connects
every supplied server before the sample factory runs, even though the model only invokes the smoke
tool. Keep generated machine-specific paths out of commits.

### Zed

Add the generated `agent_servers` entry as a custom External Agent, and the `context_servers`
entry as a local MCP server. Select **Anvia smoke** for a new thread in the disposable project.
Use `dev: open acp logs` to inspect the protocol when UI behavior is unclear. Confirm that
`session/new.mcpServers` contains the stdio declaration named `anvia-smoke`, rather than assuming
that a visible MCP entry was forwarded. Setup follows the official
[external agent](https://zed.dev/docs/ai/external-agents) and
[MCP configuration](https://zed.dev/docs/ai/mcp) documentation, consulted 2026-10-17.

### JetBrains AI Assistant

With the IDE and AI Assistant plugin installed, use **Add Custom Agent** in AI Chat to open
`~/.jetbrains/acp.json`. Merge `jetbrains-acp.json`; configure the generated `jetbrains-mcp.json`
in the AI Assistant MCP settings. Enable forwarding custom MCP servers for this agent and leave
integrated IntelliJ MCP disabled for this stdio-only exercise. Select **Anvia smoke** in a new chat.
Use **Get ACP Logs** to investigate failures. Record the IDE build and plugin version separately.
See the official [ACP](https://www.jetbrains.com/help/ai-assistant/acp.html) and
[MCP](https://www.jetbrains.com/help/ai-assistant/mcp.html) setup documentation, consulted 2026-10-17.

### Neovim / CodeCompanion

Install CodeCompanion through its documented plugin setup, then merge the generated adapter into
the existing `require("codecompanion").setup(...)` call. Open the disposable project with Neovim,
start `:CodeCompanionChat`, and select `anvia_smoke`. The adapter supplies a direct stdio MCP
declaration and uses CodeCompanion's message helper. Its auth handler returns true because the
sample needs no credentials. Record both `nvim --version` and the plugin revision; this template
has not been executed in Neovim. See the official
[custom ACP adapter and MCP configuration](https://codecompanion.olimorris.dev/configuration/adapters-acp)
documentation, consulted 2026-10-17. MCP servers need not appear in the chat context UI; check the
permission request and marker instead.

## Manual acceptance checklist

Run every row in Zed and at least one independent editor, ideally all three. Send each prompt as
plain text with no attached files or extra instructions. Start a new chat before each numbered
scenario so counts are deterministic. The model recognizes exact trimmed `smoke:*` inputs; these
are plain prompt strings, not registered slash commands.

1. **Multi-turn and streaming:** Send `hello`, then `again`. The second response must show
   `Turn: 2. Counter: 0.` and `Previous: hello.`. Each response emits three lines 120 ms apart;
   observe incremental rendering or confirm three ordered `agent_message_chunk` notifications
   before `end_turn`. Record UI batching separately from wire streaming.
2. **Tools and approvals:** Send `smoke:tool`, choose allow once, and observe a pending tool card,
   approval dialog titled `Increment smoke counter`, completed status and `Counter: 1.`. Repeat
   and reject once: the counter remains 1 and the tool is failed/denied. Repeat and allow: counter
   becomes 2. Each call must have a distinct ID. The tool changes only in-memory state.
3. **Cancel generation:** Send `smoke:wait`. After `Waiting for cancel…`, use the editor's stop
   action before the 60-second safety ceiling. Confirm the prompt settles with `cancelled` and no
   later output. Send `fresh`; it should show `Turn: 1. Counter: 0.` because the cancelled turn was
   not retained. The editor remains usable without restarting the agent.
4. **Cancel permission:** Send `smoke:tool` and stop while permission is pending. If the editor
   leaves the old dialog open, select allow after cancellation. Send `fresh`; counter remains 0.
   Record if the editor instead closes the old dialog. Automated tests cover the forced late reply.
5. **Editor-forwarded MCP:** With the generated server enabled, send `smoke:mcp`; reject once,
   then repeat and allow. Expect `ACP_MCP_SMOKE_OK calls=1`; another approved call returns
   `calls=2`. This proves discovery, invocation, result propagation and no call on denial.
   Reconnect with that server disabled and repeat: expect the explicit unavailable-server message.
6. **Isolation and disconnect:** Open another chat/workspace; counter and turn count start at
   zero/one. Close the test threads/agent connection while a wait or approval is pending. Verify
   the owned agent and session MCP children exit and no stale UI completion appears. Do not count
   an editor's separate MCP process as a leaked session child.
7. **Startup/config errors:** In a temporary copy of the agent entry, remove the module argument,
   then try a nonexistent module path. Expect process exit 1, stderr usage/startup diagnostics,
   and no non-JSON stdout. Restore args. Set agent env `ANVIA_ACP_SMOKE_FAILURE=missing-config`,
   restart the agent, and check the fixed recovery message in stderr/editor logs.
8. **Missing credentials:** Set that env value to `missing-credentials` and restart. Initialization
   still advertises no auth methods; creating a session must fail with `configuration_error` and
   stderr directing the user to their factory credentials. No login loop should occur. Remove the
   variable, restart, and verify `hello` works. Record whether the editor exposes useful stderr;
   a generic error without access to diagnostics is a UX gap, not a pass for clear errors.

For Neovim, set the simulation variable in the environment that launches the disposable Neovim
process (for example, `ANVIA_ACP_SMOKE_FAILURE=missing-credentials nvim`), then create a new ACP
chat. Exit that test process and relaunch without the variable to recover. The generated Lua
adapter inherits the process environment; it does not configure a provider or credentials.

For each editor record: date, OS, Node, package revision, editor and plugin versions, scenario
results, observed capabilities, and a short sanitized failure description. Include synthetic-only
screenshots if available. Do not commit full wire logs, paths to personal workspaces, prompts from
real projects, headers, environment values or credential data. Remove only the temporary smoke
entries after the run and restore any test-specific changes.

## Follow-ups and acceptance gates

| ID                | Finding / required action                                                                                                       | Owner task                            | Completion evidence                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| ACP10-ZED         | Installed Zed cannot be controlled in this session. Run scenarios 1–8 with GUI access.                                          | ACP 10 operator                       | Versioned results and synthetic UI evidence; replace “Not run” cells individually.                     |
| ACP10-INDEPENDENT | No independent editor is available. Run the same scenarios in JetBrains or Neovim; keep the third editor explicitly unverified. | ACP 10 operator                       | IDE/plugin versions and actual editor results, not fixture passes.                                     |
| ACP10-MCP         | Actual editor forwarding format and teardown are unverified. Capture transport type/name only; exercise the marker.             | ACP 10 operator                       | Forwarded stdio declaration, denied call count, allowed marker, child teardown.                        |
| ACP10-ERRORS      | Generic factory errors do not explain missing credentials on the wire; stderr visibility varies by editor.                      | ACP 10 verification; ACP 14 if needed | User can find actionable safe diagnostics without an ACP auth loop; file a narrowly scoped fix if not. |
| ACP10-DOCS        | Snippets follow current vendor docs but editor versions may differ. Promote only verified recipes.                              | ACP 16                                | Document tested versions and gaps; add a provider-backed cookbook separately.                          |

No runtime API behavior or published README changed, so no changeset is needed under
`CHANGESET_GUIDE.md`. No generated artifacts are tracked for this task. Persistent sessions,
durable execution, CLI integration, CI and publication remain later tasks.
