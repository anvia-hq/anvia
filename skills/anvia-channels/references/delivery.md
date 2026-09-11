# Delivery and raw events

Not every channel consumer needs an agent. An alerting worker only needs an
adapter and `sendChannelMessage(channel, address, message)` from
`@anvia/channel` — receiving never has to be started:

```ts
import { sendChannelMessage } from "@anvia/channel";
import { discord } from "@anvia/discord";

const channel = discord({ token: process.env.DISCORD_BOT_TOKEN ?? "" });

await sendChannelMessage(
  channel,
  { platform: "discord", conversationId: process.env.DISCORD_CHANNEL_ID ?? "" },
  {
    text: monitoringReport,
    actions: [{ id: "incident:ack", label: "Acknowledge", style: "primary" }],
  },
);
```

## sendChannelMessage vs channel.send

Use `sendChannelMessage()` at application boundaries: it validates the message
and splits long text to fit the platform before delivering each part. Use
`channel.send()` only for one already-bounded logical message — piping dynamic
or generated text through it is how messages silently get truncated.

Related helpers, all from `@anvia/channel`:

- `splitChannelText` / `splitChannelMessage` — the splitter, if you need the
  parts yourself.
- `validateChannelMessage` / `validateChannelActions` /
  `validateChannelAttachments` — the validators.
- Limits are exported constants: `MAX_CHANNEL_ACTIONS`,
  `MAX_CHANNEL_ACTION_ID_BYTES`, `MAX_CHANNEL_ACTION_LABEL_LENGTH`,
  `MAX_CHANNEL_ATTACHMENTS`.
- `isChannelActionId` — action IDs must be CLI-safe strings.
- `PartialDeliveryError` — thrown when a split message only partially
  delivered; catch and reconcile rather than resend blind.

Messages are `{ text, actions?, attachments?, replyToMessageId? }` and resolve
to `SentChannelMessage` `{ id, address }` for later edits/deletes/reactions.

## Direct event handling

To consume events without the agent bridge, subscribe with a
`ChannelEventHandler` and switch on the `ChannelEvent` union: message,
message-edited, message-deleted, reaction, action, or command events — each
carries the normalized content plus the raw payload as `RawEvent`. Action and
command events are how button taps and slash commands reach application code
when no agent is attached.
