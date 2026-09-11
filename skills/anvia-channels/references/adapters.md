# Channel adapters

Three first-party adapters, each a single factory call. All factories read
credentials from the environment at the call site — never a literal.

| Platform | Factory                                             | Input transport         | Delivery |
| -------- | --------------------------------------------------- | ----------------------- | -------- |
| Telegram | `telegram({ token })` from `@anvia/telegram`        | Long polling or webhook | Bot API  |
| Discord  | `discord({ token })` from `@anvia/discord`          | Gateway                 | REST     |
| Slack    | `slack({ appToken, botToken })` from `@anvia/slack` | Socket Mode             | Web API  |

## Option shapes

Each factory accepts either live credentials or an injected low-level client for
offline tests — the unions are exclusive (`token` and `api` are never both set):

- `telegram({ token, baseUrl?, fetch?, maximumAttachmentBytes?, polling?, webhook?, onError? })`
  or `telegram({ api })`. `onError(error, context)` receives
  `context.operation`.
- `discord({ token, messageContentIntent?, fetch?, maximumAttachmentBytes?, onError? })`
  or `discord({ gateway })`. Set `messageContentIntent` when the bot needs
  message content (privileged intent on Discord's side).
- `slack({ appToken, botToken, fetch?, maximumAttachmentBytes? })` or
  `slack({ transport })` — app-level + bot-level tokens are both required.

Adapters also expose the classes directly (`TelegramChannel`, `DiscordChannel`,
`SlackChannel`) if you need the type; prefer the factories.

## Capabilities

Adapters advertise what the platform supports through `channel.capabilities` —
gate optional behavior on it instead of hard-coding per-platform branches.
All three support message edits, deletion, and reactions; files and
replies/threads everywhere; native actions differ (Discord buttons, Slack Block
Kit buttons, Telegram inline keyboard); typing indicators exist on Discord and
Telegram but not Slack.

## Addresses and events

Every conversation is a `ChannelAddress`: `{ platform, conversationId }`.
`platform` is a plain string — custom adapters choose their own.

Inbound payloads are validated at runtime and normalized into a `ChannelEvent`
union: message, message-edited, message-deleted, reaction, action, or command
events. You rarely touch raw platform payloads unless you write an adapter.

## Custom adapters

Implement `Channel<RawEvent>` from `@anvia/channel`: a `platform` string,
optional `capabilities`, send/edit/delete/react operations, and an event
subscription that normalizes raw payloads into `ChannelEvent` values at the
boundary. Wrap any adapter with `createRateLimitedChannel(channel, options)`
to throttle outbound delivery.
