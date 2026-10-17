# ACP 09 verification

The adapter is tested with deterministic Anvia agents, without provider credentials or model
network calls. `pnpm --filter @anvia/acp test` builds the real launcher and runs the unit,
wire, subprocess and local MCP integration suites. `stdio-client.ts` parses every stdout line,
validates its JSON-RPC envelope, rejects partial trailing frames, and checks exactly one response
for each client request after the process exits. It retains ordered frames for assertions and
uses bounded waits and process cleanup.

`fixtures/conformance-agent.mjs` is a test-only streaming session factory. Ordinary prompts return
synthetic workspace/history observations; `fixture:tools` requests two approved in-memory actions
using repeated provider IDs, and `fixture:wait` waits for the provider abort signal. Import,
generation, tool and disposal logs exercise the launcher's stderr redirection. The optional editor
host uses the built library with explicit read/terminal opt-in; it executes no local shell command.

## Coverage map

| Area / modules                                            | Automated coverage                                                                                                                                                                                                                                                      |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `connection`, `stdio`, `wire/v1`, `wire/stream`, `errors` | `connection.test.ts`, `stdio-conformance.test.ts`: unsupported-version negotiation to v1, unknown methods, invalid params/envelopes, split UTF-8, input limits, sanitized errors, EOF and output failure                                                                |
| `session-manager`, `session`, `memory`, `limits`          | `session.test.ts`, `support-modules.test.ts`, subprocess conversations: distinct canonical cwd, concurrent sessions, isolated histories, private snapshots, atomic bounds, overlap rejection and disposal                                                               |
| `content`                                                 | `content.test.ts`: text/images/links, validation and byte bounds; `editor-features.test.ts`: embedded text and command expansions                                                                                                                                       |
| `events`, `presentation`                                  | `events.test.ts`, `updates.test.ts`, `editor-features.test.ts`: repeated provider IDs, partial calls, out-of-order results, reasoning privacy, guardrails, diffs and path mapping; subprocess continuation IDs and chunk ordering                                       |
| `permissions`, `pending-requests`, `turn-budget`          | `permissions.test.ts`, `pending-requests.test.ts`, `support-modules.test.ts`: allow/reject/malformed responses, elicitation, cancellation/late replies, cross-segment model/time/cost limits; real subprocess permissions                                               |
| `mcp`                                                     | `mcp.test.ts`, `mcp-http.test.ts`: legacy/modern negotiation, collisions, partial setup failure, authorization, localhost/exact-endpoint trust, redirects and teardown; subprocess cancellation of an approved real MCP call, cancellation notification and child exits |
| `editor-tools`, `config`                                  | `editor-features.test.ts`, `support-modules.test.ts`: capability opt-in, paths/symlinks, terminal lifecycle, config isolation/rebuild/rollback; real stdio cancellation during editor reads and terminal waits, late results and kill/release                           |
| `launcher`, `cli`, public exports                         | `launcher.test.ts`: built entrypoint, module shapes, import failure, help, signals, noisy modules; subprocess conversations check stdout throughout complete turns and shutdown                                                                                         |
| Cancellation and settlement                               | `cancellation.test.ts`, `updates.test.ts`, `stdio-conformance.test.ts`: generation/local/MCP/editor cancellation, busy quarantine, late approval/output suppression, ordered updates and one final settlement                                                           |

`persistence.test.ts` also exercises `session-store` and `transcript`: three actual subprocesses
share an opt-in file store, replay retains the exact visible chunks/tool IDs, resume is silent and
continuation uses prior model context without executing old tools. Unit/wire coverage includes
missing vs empty records, metadata-only filtered pagination, store capability gates, config restore,
workspace restrictions, replay rollback, close/cancellation and failed atomic writes.
The ACP 11 review adds actual terminal command replay across processes (without repeated terminal
callbacks or raw output), malformed stored display fields, and cancelled-turn tool ID collisions
after silent resume. Those regressions failed before their fixes.

`types.ts` is checked by the package TypeScript build and typed tests; it has no runtime behavior.
This map records behavioral coverage, not a claim of exhaustive branch or line coverage.

## Reproduce the upstream TCK run

The [experimental ACP TCK](https://agentclientprotocol.com/libraries/testing) launches a fresh
agent subprocess per test. Pin the checkout and its Python dependency lock to keep results
comparable. Prerequisites: `uv`, git, Node and this workspace's installed pnpm dependencies.
The pinned TCK requires Python 3.14 or later; uv can provision it. Network access is needed for
the initial checkout/dependency installation, but the tests use no model services.

```sh
git clone https://github.com/agentclientprotocol/acp-tck.git /tmp/acp-tck
git -C /tmp/acp-tck checkout fa00ccdc13dfaa4b288a91877c1f3e468af4aa7d
pnpm --filter @anvia/acp test:tck /tmp/acp-tck /tmp/acp-tck-summary.json
```

The runner refuses a different or dirty TCK revision, builds the package through `pretest:tck`,
runs the entire v1 suite with `--frozen` dependencies, and writes a compact JSON summary. It
also requires every mandatory requirement to **PASS**, so an unexercised cancellation cannot
silently pass. Raw reports, traffic and stderr are temporary and are not retained. The output
summary records tool versions, environment, schema revision, every requirement/test outcome and
skip reason. `test:tck` is separate from ordinary tests so Python/network setup is not an implicit
requirement of `pnpm test`.

## Recorded result

See [tck-results.json](./tck-results.json) for the machine-readable run. TCK `0.2.0`, revision
`fa00ccdc13dfaa4b288a91877c1f3e468af4aa7d`, checks its vendored schema revision
`6d08f412a7a1370d3cc9a124e3be3d6acf92641e` against ACP SDK `1.9.0`.

The result is **CONFORMANT**: 47 pytest tests passed, 9 skipped, no failures.
Rerun on 2026-10-17 against the ACP 11 tree (persistent sessions plus the review fixes).

| Requirement tier | Passed | Failed | Skipped | Not tested |
| ---------------- | -----: | -----: | ------: | ---------: |
| Mandatory        |     21 |      0 |       0 |          0 |
| Capability       |     10 |      0 |       9 |          0 |
| Advisory         |     12 |      0 |       0 |          0 |
| Informational    |      4 |      0 |       0 |          0 |

Both cancellation requirements and all advertised session lifecycle requirements passed.
Skips cover extra directories,
legacy modes, media/context capabilities and logout; authentication has no advertised method,
and the default mode catalog has no alternative value to select. Unit/wire tests separately
exercise no-op authentication and the opt-in capabilities/configuration implemented in ACP 08.
Requirement counts differ from pytest counts because tests can cover multiple requirements.

This result applies to the built v1 adapter with the deterministic factory and default options.
It is not official certification or proof of every application's tools/model behavior. The upstream
v1 TCK does not cover MCP, filesystem or terminal operations; local integration tests cover those
surfaces. No TCK requirements were removed or patched, and no production capability was enabled
solely to obtain a passing verdict.

## Manual follow-up (ACP 10)

The [ACP 10 compatibility matrix](./EDITOR_COMPATIBILITY.md) now provides the shared offline
sample, config generator, automated smoke command and per-editor manual scenarios. Its fixture
results do not count as real editor verification; GUI acceptance remains open.

- Launch the configured application factory in Zed and one independent client (JetBrains or
  Neovim); verify multi-turn text and two distinct workspaces.
- Approve, deny and cancel a tool; verify displayed IDs/results and no execution after denial.
- With explicit editor opt-in, verify unsaved-buffer reads and terminal cancellation/cleanup.
- Confirm stdout remains protocol-only and disconnect terminates session-owned MCP resources.

These GUI checks were not run for ACP 09. ACP 11 persistence coverage is described below; durable
execution, v2 and publishing remain separate tasks. No generated build artifacts are committed; the TCK summary is the only
intentionally recorded generated artifact.

## Manual editor persistence checklist (ACP 11)

No GUI persistence verification was run for this task. The headless tests and TCK validate protocol
behavior; Zed/JetBrains/Neovim display/reconnect UX remains manual. Use a private temporary data path
and configure the editor to launch Node with `test/fixtures/persistence-host.mjs` plus that absolute
JSON path (build first), or use your own library host with `FileAcpSessionStore`.

- Create a session, send a text prompt and approve `fixture:tools`; record the visible tool cards.
- Close and reopen the session. Confirm list retains it, title/workspace are correct and a load
  replaces history exactly once with matching tool cards. Confirm resume adds no historical output.
- Restart the host process, restore the same session and send a new prompt. Confirm prior user
  messages remain context and old tool actions do not execute again.
- Close during `fixture:wait`; confirm the prompt is cancelled, the editor remains responsive and
  the stored record contains only earlier completed turns.
- Delete the session, restart and confirm it stays absent from list and cannot load/resume.
- Repeat in a second independent editor and record exact versions, config and observed behavior
  in [EDITOR_COMPATIBILITY.md](./EDITOR_COMPATIBILITY.md). Remove the temporary store afterward.
