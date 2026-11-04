# Mid-thread provider switch: review findings

Scope: a Studio or agent session whose earlier turns were produced by one provider
(OpenAI Responses, OpenAI Chat Completions, Azure OpenAI, Gemini, Anthropic) and whose
next run uses another provider. Replayed history is the only state the next provider
sees, so the question is what that history contains and what each adapter does with it.

How the path works (code read, 2025 baseline `3eca2cb2`):

- Each run picks its model per request (`packages/tool-studio/src/runtime/agent-runs.ts`,
  `runs.ts`). Session memory is per session, not per model. So the stored history
  is replayed to whichever provider runs next.
- The runtime stores provider and model on every assistant message under
  `metadata.anvia.generation` (`packages/core/src/internal/agent-runtime/agent-run.ts`
  ~line 1511, read by `getAssistantGenerationMetadata` in
  `packages/core/src/completion/types.ts` ~line 469). Nothing in core filters history
  by provider; each adapter maps the history itself.
- Durable runs have a fixed model per registration (`packages/durable/src/execution.ts`
  ~line 117), so they never switch mid-run. A resumed run with another model replays
  the same history and is covered by the same findings.

Reproduction tests were added first (they fail on the baseline, except where noted):
`packages/provider-anthropic/test/provider-switch.test.ts`,
`packages/provider-openai/test/provider-switch.test.ts`,
`packages/provider-gemini/test/provider-switch.test.ts`,
`packages/tool-studio/test/runner.test.ts` (test "does not replay session controls ...").

---

## 1. OpenAI reasoning replayed to Anthropic as unsigned `thinking` blocks

- Status: **confirmed** (failing test; reproduced on baseline).
- File: `packages/provider-anthropic/src/anthropic/completion.ts`,
  `messageToAnthropicMessages` (~line 1008) and `reasoningContentToAnthropicBlocks`
  (~line 1083).
- What happens: every stored reasoning detail becomes a `thinking` block. OpenAI
  reasoning details of type `text` (`reasoning_text`) and `summary` have no signature,
  so the block is sent with no `signature`. Anthropic requires a signature on every
  thinking block it receives back, so the request is expected to be rejected (400).
  The Anthropic API rule is from its documentation and was not run live here.
- Reproduce: `pnpm --filter @anvia/anthropic test -- provider-switch`. Test "does not
  replay OpenAI reasoning items as Anthropic thinking blocks".
- Severity: high. Any OpenAI reasoning model with a summary or visible reasoning,
  continued on Anthropic, fails the run.
- Planned fix: skip all reasoning when the generation provider is known and is not
  `anthropic`. When it is unknown, skip unsigned text and summaries. Never emit a
  `thinking` block without a signature.

## 2. Gemini thought signatures replayed to Anthropic

- Status: **confirmed** (failing test).
- File: same as 1. Gemini sets `signature` on `text` details
  (`packages/provider-gemini/src/gemini/completion.ts` ~line 896-908).
- What happens: the Gemini signature is copied into a `thinking` block's `signature`.
  Anthropic validates the signature, so the request is expected to fail.
- Reproduce: test "does not replay Gemini thought signatures as Anthropic thinking
  signatures".
- Severity: high (same cause as 1).
- Planned fix: same gate as 1 (origin `gemini` is foreign to Anthropic).

## 3. Anthropic thinking signatures replayed to Gemini as `thoughtSignature`

- Status: **confirmed** (failing test, Gemini side).
- File: `packages/provider-gemini/src/gemini/completion.ts` ~lines 386-391
  (`reasoning.signature` becomes `thoughtSignature`).
- What happens: the Anthropic `thinking` signature is sent as a Gemini
  `thoughtSignature` on a `thought` part. Gemini validates this field, so the request is
  expected to be rejected. Test: "does not send Anthropic thinking signatures as Gemini
  thought signatures".
- Severity: medium. Only when Anthropic-produced reasoning is replayed to Gemini.
- Planned fix: keep Gemini's own signatures, drop foreign ones (origin not `gemini`).

## 4. Reasoning-only foreign turn produces an empty Anthropic assistant message

- Status: **confirmed** (failing test).
- File: `packages/provider-anthropic/src/anthropic/completion.ts`, `messageToAnthropicMessages`.
- What happens: an assistant turn whose only content was reasoning (for example an
  OpenAI reasoning item with encrypted content and no visible text) becomes
  `{ role: "assistant", content: [] }` once the reasoning is dropped. Anthropic
  rejects empty message content except for a final assistant message.
- Severity: medium. It only appears once issue 1 is fixed, or when the reasoning-only
  turn is not the final one.
- Planned fix: omit an assistant message whose Anthropic content is empty.

## 5. Unsigned `thinking` from unknown-origin history

- Status: **confirmed** (failing test, no generation metadata).
- File: `packages/provider-anthropic/src/anthropic/completion.ts`, `reasoningContentToAnthropicBlocks`.
- What happens: hand-built or metadata-less history with an unsigned `text` detail
  is sent as an unsigned `thinking` block.
- Severity: low to medium.
- Planned fix: as in 1 (unknown origin: only signed thinking and redacted thinking).

## 6. OpenAI Responses sends an Anthropic tool id as `function_call.id`

- Status: **confirmed** (failing test).
- File: `packages/provider-openai/src/openai/responses.ts` ~lines 862-866
  (`messageToResponsesInput`, `function_call` item uses `id: content.toolCallId`).
- What happens: an Anthropic tool call has `toolCallId` = `callId` = `toolu_...`.
  The replay sends that as `function_call.id`. OpenAI expects item ids to start with
  `fc`, so the request is expected to be rejected. `call_id` is correct.
- Reproduce: `pnpm --filter @anvia/openai test -- provider-switch`, test "does not send an
  Anthropic tool id as a Responses function_call id".
- Severity: high for Anthropic-to-OpenAI Responses switches that use tools.
- Fix: send `id` when the origin is unknown, or when the origin is OpenAI or Azure and the id
  starts with `fc`. The origin alone is not enough: Chat Completions reports provider `openai`
  and Azure reports `azure-openai` for both its Chat Completions and Responses models, so their
  `call_...` ids would still be sent as `function_call.id` (found in review by the hammer bot
  on PR #617, twice). The Azure test fixture used `item_1`; it now uses `fc_1`, a realistic
  Responses id. `call_id` stays. (`id` is optional on input `function_call` items.)

## 7. Session-persisted controls rejected by the newly selected model

- Status: **confirmed** (failing test; the run returns 400).
- File: `packages/tool-studio/src/runtime/agent-runs.ts` ~lines 196-202 (persisted
  controls are merged into the request body), then `selectRunModel` ~line 300 and
  `packages/tool-studio/src/runtime/models.ts` ~line 219
  (`assertCompletionControlsSupported`, `packages/core/src/completion/types.ts` ~line 930).
- What happens: a run that sends no `controls` reuses the session's last controls. For
  example `reasoningEffort: "high"` from a model that has the control. If the next run
  switches to a model without that control, or without that value, the run fails with
  "does not support completion control" and HTTP 400. Agent-level default controls are
  already filtered for the target model (`compatibleAgentControls`); persisted ones are not.
- Reproduce: `pnpm --filter @anvia/studio test -- runner.test` (new test).
- Severity: high for the Studio user (every later message fails until controls are
  sent again).
- Planned fix: keep only persisted controls the selected model offers, using the
  same rule as `compatibleAgentControls`.

## 8. Gemini tool-call ids repeat across turns; Anthropic tool_use ids must be unique

- Status: **confirmed in code, not run live**. The duplicate id is produced by the
  Gemini adapter. The uniqueness rule is from the Anthropic API documentation.
- File: `packages/provider-gemini/src/gemini/completion.ts` ~line 1125 (`gemini-tool-${partIndex}`).
  The id is per response part index, so turns repeat it. It is used as `tool_use.id`
  and `tool_result.tool_use_id` on Anthropic.
- What happens: after a Gemini history with two tool turns, both calls can have the
  same `gemini-tool-0` id. The Anthropic request then has duplicate `tool_use` ids,
  which Anthropic is expected to reject.
- Severity: medium (depends on Gemini calls without ids and on repeated part indices).
- Planned fix: in the Anthropic request builder, when a tool-call id has already been
  used earlier in the request, give that occurrence a new id, and give its matching
  tool result the same new id (match by the latest call with that id). Ids that are
  already unique are not changed.

## 9. Provider-hosted tools are sent to a model that does not support them

- Status: **confirmed** (by code path: core refuses the request, so the run fails
  with a clear error; no bad request is sent).
- File: `packages/core/src/completion/types.ts` ~line 908
  (`assertCompletionRequestSupported`); Anthropic does not declare `providerTools`
  (`packages/provider-anthropic/src/anthropic/completion.ts` ~line 66).
- What happens: an agent with an OpenAI-only provider tool (`ProviderTool`, for
  example web search) that switches to Anthropic fails with
  "does not support provider-executed tools".
- Severity: medium. It is a real failure, but the behaviour is a design choice:
  drop the tool and warn, or fail. Not changed in this PR; needs the maintainers' decision.

## 10. Anthropic provider options from another provider

- Status: **not confirmed in this repo**. Studio does not set `providerOptions`
  (checked: `packages/tool-studio/src`, `packages/durable/src`).
- File: `packages/provider-anthropic/src/anthropic/completion.ts`, `toAnthropicMessagesParams` (~line 538).
- What happens: the adapter spreads `providerOptions` into the request. An application
  that uses one agent for several providers and keeps OpenAI-only keys (for example
  `reasoning`, `store`) would send them to Anthropic. This is an application
  configuration risk, not a bug in the adapter.
- Planned fix: none. Document it for application authors.

## 11. OpenAI `previous_response_id` or server-side state leaking across providers

- Status: **not applicable**. No adapter in `packages/` sends `previous_response_id`
  or a conversation id (grep of `packages/*/src`, excluding `dist`).

## 12. Chat Completions reasoning replay

- Status: **not applicable**. `packages/provider-openai/src/openai/chat-completion.ts`
  (~line 830) sends only assistant text and tool calls, never reasoning.

## 13. Consecutive same-role messages and system messages mid-thread

- Status: **not confirmed as a bug**.
  - Anthropic merges consecutive turns of the same role (documented behaviour), so
    no change is made.
  - System messages in the middle of history are hoisted into the top-level `system`
    field (`systemFromMessages`, ~line 630). Order changes, but no request fails.

## 14. Anthropic thinking-required rule with tool use

- Status: **not applicable to a switch**. Anthropic requires thinking blocks on the
  last assistant turn when extended thinking is on and that turn has tool use. A
  mid-thread switch happens between runs, and a completed run ends with a text turn.
  Within a run the provider does not change.

## 15. Tool-call ids for OpenAI Chat Completions

- Status: **not confirmed**. Chat Completions ids are opaque strings. Anthropic `toolu_`
  ids and Gemini `gemini-tool-N` ids are accepted. Duplicates are covered by 8.

## 16. Anthropic `reasoningEffort` values

- Status: **covered by 7**. Values are checked per model at run start, so an invalid
  value is a clear 400, not a bad request sent to the provider. The reverse path
  (agent defaults) already filters.

---

## Status after the fix

Fixed (each has a test that failed before the change and passes after it):

- 1, 2, 5: Anthropic replays reasoning only when it is its own or of unknown origin, and
  then only signed thinking. Test: `provider-anthropic/test/provider-switch.test.ts`.
- 4: an assistant turn left with no content is omitted. Same file.
- 8: duplicate tool-call ids in one Anthropic request are renamed, and each result follows
  its call. Same file, "keeps tool_use ids unique ...".
- 3: Gemini drops signatures from another provider's reasoning. Test:
  `provider-gemini/test/provider-switch.test.ts`.
- 6: OpenAI Responses sends `function_call.id` only for unknown origins, or OpenAI and Azure origins with ids starting with `fc`
  (or its origin is unknown). Test: `provider-openai/test/provider-switch.test.ts`.
- 7: Studio keeps only the persisted controls the selected model offers, and records the
  result. Test: `tool-studio/test/runner.test.ts`, "does not replay session controls ...".

Not fixed:

- 9: provider-hosted tools on a model that does not support them. The run fails with a clear
  error. Dropping the tool or failing is a product decision.
- 10: application-level `providerOptions` that name another provider's keys. Not in Studio.
- 11-16: not applicable or not confirmed (see each item).

Not verified live: all Anthropic, OpenAI and Gemini rejection behaviour above is taken from
their API rules and was checked against the request bodies in tests, not against the live APIs.

Pre-existing, unrelated: `tool-studio/test/runner.test.ts` "replays persisted pipeline runs
outside the first runs page" times out at 5 s on the unchanged source as well.
