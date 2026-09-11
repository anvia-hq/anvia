# Channel agent bridge

`createChannelAgent({ channel, agent, ... })` from `@anvia/channel-agent` runs
an Anvia `Agent` behind any adapter and returns a `ChannelAgentService` with
`start()` / `stop()`. `serveChannelAgent(options)` is the shorthand that also
starts it. The executor contract is structural — anything with `generate` /
`stream` (plus optional `resume`), i.e. an `Agent` — so tests can pass a fake.

## Options that matter

- `shouldHandle(event)` — filter inbound messages; the default
  (`defaultShouldHandleChannelEvent`) drops bot/self messages and non-text
  noise. Override for allowlists or group-chat rules.
- `createSession(event)` — return a `MemoryScope` to scope agent memory per
  conversation or per user. Defaults to `defaultChannelAgentSession`
  (per-conversation); use `channelConversationUserSession` when each sender
  needs their own thread of memory, `channelConversationSession` /
  `channelConversationKey` for custom keys.
- `createPrompt({ event, context })` — reshape the prompt before the agent runs
  (`channelMessagePrompt` is the default builder).
- `renderOutcome({ outcome, event })` — turn the agent outcome into the reply
  text or a full `ChannelMessage` (actions, attachments).
- `streaming` — `{ enabled?, editIntervalMs?, placeholder? }`; the bridge edits
  one message in place as the agent streams. `placeholder: false` disables the
  "Thinking…" stub.
- `acknowledge` — shorthand for a receipt reaction: `"👀"` or
  `{ reaction, completeReaction?, ... }`; `false` disables.
- `commands` — handle platform slash commands; `false` (default) ignores them.
- `multimodal` — inbound attachments become prompt parts when enabled.
- `errorMessage`, `emptyResponseMessage` — user-facing fallbacks.
- `onError(error, context)` — always set it. `context.stage` is one of
  `"filter" | "prepare" | "acknowledge" | "interaction" | "agent" | "delivery"`,
  which tells you where a failure happened.

## Approvals and questions

Tool approvals and agent questions pause instead of failing: the bridge stores
the pending interaction and renders platform actions (buttons/inline keyboards)
so the conversation can resume when the user taps. `interactions` controls this
— pass `false` to disable, or options with a store:

- `MemoryChannelAgentInteractionStore` — in-memory, fine for dev.
- `SqliteChannelAgentInteractionStore` — durable; pending interactions survive
  restarts.
- Helpers: `renderChannelAgentInteraction`, `parseChannelAgentActionResponse`,
  `channelInteractionActions`, `channelInteractionKey`.

## Lifecycle

`start()` begins receiving; `stop()` drains and disconnects. Own the shutdown
path: stop the service, then close memory/interaction-store clients. Guard
against double-shutdown when both SIGINT and SIGTERM arrive.
