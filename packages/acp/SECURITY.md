# ACP security model

ACP 14 audit, 2026-10-18. These defaults supersede the stdio launch trust described in ACP 07.
The adapter is a local framework host, with no authentication methods. Do not expose its byte
streams to multiple users or a network listener without host-owned authentication, authorization,
connection quotas and exclusive ownership of persisted sessions.

## Assets and trust boundaries

Protect host execution, provider credentials, workspace files, private model history, checkpoints
and process capacity. Treat client RPCs, capabilities, `_meta`, MCP declarations/catalogs/results,
model tool arguments and stored display records as untrusted input. The host's factory, policies,
custom store, presentation callbacks and local tools are trusted executable code. They can bypass
adapter policy if implemented incorrectly; this library is not an OS sandbox.

Trusted launcher modules may export `acpOptions.mcp`, forwarded as host MCP policy to `serveStdio`.
Only that option is read; client declarations and `_meta` cannot configure host policy. Without
the export, both launchers retain the disabled-by-default MCP policy.

| Threat                                                       | Control                                                                                                                                                                                                                                                                                                        | Remaining host responsibility                                                                                                                                                                                                                                       |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Client requests arbitrary process execution                  | Stdio MCP disabled by default; `mcp.stdio: true` **and** `authorizeServer` returning exactly `true` for every declaration are required before any server connects.                                                                                                                                             | Approve the complete executable/argv/env/cwd tuple, or obtain an operator decision in the callback. Never approve solely by client-selected name.                                                                                                                   |
| Server launch executes code before a tool permission request | Setup host approval is separate from once-only tool approval. MCP tools always retain `requiresApproval: true`; declarations and annotations cannot grant execution.                                                                                                                                           | A setup callback returning `true` is the host's privileged launch approval. Treat installation, discovery and the SDK's separate probe process as code execution too.                                                                                               |
| Shell/env injection or inherited credentials                 | Argv spawning without a shell; NUL checks; env identifier validation and duplicate detection. Never spread `process.env`; MCP SDK platform allowlist plus approved supplied values only.                                                                                                                       | An approved executable can itself be a shell, loader or interpreter; env keys like `NODE_OPTIONS`, `PATH`, `LD_PRELOAD` are privileged. Restrict them in the callback. MCP stderr is a host diagnostic channel, not sanitized client output.                        |
| SSRF, metadata access, rebinding or header theft             | HTTP disabled by default. Existing `@anvia/mcp` strict transport uses `url-safety.ts`: public hostname/address validation, protected DNS lookup, bounded response messages. No SSRF-disable option is exposed here.                                                                                            | HTTP opt-in authorizes public network reach. For narrower egress require `authorizeServer` allowlists or an OS/network policy.                                                                                                                                      |
| Private-network exception expands trust                      | Only exact host-configured `trustedHttpEndpoints` plus pinned IPs bypass public-address policy. Metadata, link-local, mapped IPv6 and reserved addresses remain blocked. Endpoint redirects fail and headers stay endpoint-scoped.                                                                             | Approve endpoints and IPs deliberately; manage TLS, remote authentication and credentials. No trust from client `_meta` or declarations.                                                                                                                            |
| Traversal or cross-workspace editor access                   | Admission roots (`workspaceRoots`) do not grant editor access. Default editor roots are the canonical session cwd only. Absolute/relative paths must pass lexical containment and realpath checks on existing ancestors; dangling symlinks are rejected. Applies to reads, writes, new files and terminal cwd. | `editorWorkspaceRoots` explicitly adds directories. The editor must enforce policy atomically at access time: separate-process RPCs cannot eliminate symlink replacement races. No claim of protection against a hostile editor or concurrently mutated filesystem. |
| Terminal command escapes cwd                                 | Terminal backend disabled by default, capability intersection, once-only approval and contained cwd.                                                                                                                                                                                                           | Cwd is not a command sandbox. An approved terminal can read/write anywhere its OS identity permits; constrain executables/argv in a custom tool or use a sandbox.                                                                                                   |
| Broad or stale permissions                                   | No always-allow cache, no cross-session grants; immutable host policy; late replies invalidated on cancel/close. Read-only omits editor writes/terminals/MCP and requires explicit classification of other tools.                                                                                              | Local/provider tools must enforce their own roots/effects and approval policy. A read-only label cannot sandbox arbitrary host code.                                                                                                                                |
| Memory/CPU exhaustion                                        | Wire bytes, concurrent RPCs, active sessions including setup, pending editor requests, prompt/history, retained terminal output and load replay have host-configurable bounds. MCP setup/catalog/transport also have bounds. Backpressure: updates and replay are awaited individually.                        | Apply transport rate/time limits and provider quotas. Stores, durable journals, model/provider transient allocations and ignored aborts require host capacity/retention policy.                                                                                     |
| Error detail leaks                                           | Fixed `AcpError` kinds; `respond()` maps unknown errors to `execution_failed`; final byte-stream sanitizer replaces SDK error messages/data too. No stacks/causes, prompts, tokens, headers, continuations or invalid envelopes in error responses.                                                            | IDs are echoed by JSON-RPC. Public model text, explicitly projected tool metadata/diffs, command catalogs and user transcripts are intentional output, not error diagnostics; hosts must keep secrets out of them.                                                  |
| Replay leaks private data or repeats effects                 | Separate allowlisted display transcript; no raw model history/reasoning/tool args/results. Replay validated before notification, with no generation or historical tool execution. Resume is silent.                                                                                                            | Secure records/backups; keep FileAcpSessionStore outside editor-controlled roots. Custom stores are private per user, atomically replace records and enforce exclusive ownership.                                                                                   |
| Cancel/disconnect leaves callbacks or resources              | Abort pending editor/permission requests, clear deadlines/listeners, quarantine uncooperative work, await stream/tool teardown, dispose MCP and bindings. Deterministic stress tests inspect resource ownership after cancel/close.                                                                            | An in-process tool ignoring abort cannot be killed by a library. Late editor terminal creation must settle before release; disconnected editor cleanup is best effort. Durable disconnect intentionally detaches execution.                                         |

## Boundary verification

- `test/mcp.test.ts`: default/partial opt-ins denied without spawning; exact boolean approval;
  whole-list validation and all approvals before launch; argv/cwd/env isolation, subprocess
  rollback; real once-only MCP tool approval. Private URL tests run without listening sockets.
- `test/mcp-http.test.ts`: real strict/trusted endpoint and redirect/header tests (requires
  permission to bind localhost). URL safety is reused through `McpClient`, not copied here;
  no `@anvia/mcp` changes are needed.
- `test/hardening.test.ts`: read/write/terminal absolute and `..` escapes, prefix siblings,
  existing and dangling symlinks, broad admission roots, explicit added roots, UTF-8 terminal
  bounds, atomic replay bounds, concurrent RPC admission and private error injection.
- `test/connection.test.ts`, `test/content.test.ts`, `test/session.test.ts`,
  `test/pending-requests.test.ts`, `test/support-modules.test.ts`: framing/size errors, content,
  setup/session bounds, pending request reservations, history and positive-limit validation.
- `test/permissions.test.ts`, `test/updates.test.ts`, `test/cancellation.test.ts`,
  `test/persistence.test.ts`, `test/durable.test.ts`, `test/launcher.test.ts`: malformed/failed
  client replies, tool status without raw errors, no late grants, replay privacy, safe recovery
  errors and startup diagnostics. `test/streaming-resources.test.ts` covers long streams,
  listeners/timers/registries and disposal after cancel and close.
  `test/wire-resources.test.ts` also inspects the pinned SDK's response registry after 128
  cancellations with no client replies and after closing another pending RPC. The wire stream
  locally settles cancelled SDK requests; terminal creation stays uncancelled for late-ID cleanup.

## Error-path audit

| Path to client                                                                                            | Projection                                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SDK framing, envelope, schema, unknown method, initialization                                             | `wire/stream.ts` replaces every RPC error message/data with fixed text and a matching allowlisted kind, if any. Oversize frames close the transport.                                                                                          |
| Session setup, MCP/policy, factories, config, store/list/load/close/delete, provider/command/presentation | `wire/v1.ts` `respond()` catches all request failures; `session.ts`/`session-manager.ts` normalize execution/setup failures first. Private causes never enter error data.                                                                     |
| Tool execution errors                                                                                     | `events.ts` sends only failed/completed status. Raw local/MCP error outputs remain model context, never tool cards or replay. A model may summarize its input; host tools must redact sensitive error content before returning it to a model. |
| Permission and question callbacks                                                                         | RPC/schema failures deny or return fixed interaction errors. No raw reply errors or continuation data are forwarded.                                                                                                                          |
| Durable recovery                                                                                          | `durable.ts` emits fixed `recovery_required`/`execution_failed` kinds; snapshots and journal errors remain private.                                                                                                                           |
| Process startup and shutdown                                                                              | `launcher.ts` uses fixed startup messages on stderr, redirects stdout before module import, and awaits cleanup with a process deadline. Trusted module logs/MCP stderr belong to the host.                                                    |

The adapter does not attempt heuristic secret matching on public model text or host-authored
presentation. Such matching cannot make arbitrary model/tool output safe to share.

## Open policy questions

1. Should HTTP opt-in additionally require an exact endpoint allowlist for public addresses?
   Current opt-in permits public egress under strict URL safety; private access always requires
   the exact host exception. Hosts can already restrict public URLs via `authorizeServer`.
2. Which storage retention/quota policy should a hosted product expose? `maxSessions` bounds live
   sessions/setup, not retained records or durable work. Closing a session intentionally retains
   its history; deletion/retention and OS isolation remain host policy.
