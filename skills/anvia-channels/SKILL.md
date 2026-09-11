---
name: anvia-channels
description: Connect Discord, Slack, and Telegram to Anvia agents — channel adapters, agent-backed bots, proactive delivery, sessions, streaming, and platform actions.
---

# Anvia Channels Skill

Use this skill when the user wants an Anvia agent reachable from Discord, Slack,
or Telegram, needs proactive delivery into a channel from a worker or monitor,
or wants to handle raw platform events. The five libraries are private workspace
packages — depend on them from the channels workspace (`workspace:*`), not npm.

## Process

1. Wire the platform adapter (`references/adapters.md`) — one factory call per
   platform; credentials from the environment, never literals.
2. Run an agent behind it (`references/channel-agent.md`) — sessions and memory,
   streaming edits, acknowledgements, slash commands, paused approvals.
3. Send or receive without an agent (`references/delivery.md`) —
   `sendChannelMessage`, long-text splitting, validation, raw event handling.
4. Run `scripts/check-channels.sh` from the app root before claiming done.

## Minimal slice

```ts
import { createChannelAgent } from "@anvia/channel-agent";
import { Agent } from "@anvia/core/agent";
import { OpenAIClient } from "@anvia/openai";
import { telegram } from "@anvia/telegram";

const openai = new OpenAIClient({ apiKey: process.env.OPENAI_API_KEY ?? "" });
const agent = new Agent({
  id: "telegram-assistant",
  model: openai.completionModel({ modelId: "gpt-6-astra", api: "responses" }),
  instructions: "You are a concise assistant. Answer in the sender's language.",
});

const channel = telegram({
  token: process.env.TELEGRAM_BOT_TOKEN ?? "",
  onError: (error, context) => console.error(`[telegram:${context.operation}]`, error),
});

const service = createChannelAgent({
  channel,
  agent,
  streaming: { placeholder: "Thinking…", editIntervalMs: 750 },
  acknowledge: "👀",
  onError: (error, context) => console.error(`[channel-agent:${context.stage}]`, error),
});

await service.start();
process.once("SIGTERM", () => void service.stop());
```

## Output

Prefer one adapter, one agent, environment-read credentials, and a shutdown path
for every started service. Point to the relevant reference file instead of
pasting its contents into chat.
