# anvia-cli-agent

A small React + Ink terminal app that demonstrates a practical Anvia use case: building a streaming CLI assistant with provider-backed agents, in-memory chat history, Markdown rendering, and an optional Tavily-powered web search tool.

This project is intentionally simple. It is meant to show how an application can own the UI, environment, tools, and conversation state while using Anvia for agent orchestration.

## What It Shows

- Streaming assistant responses from an Anvia agent
- In-memory conversation history passed back into Anvia with each prompt
- Markdown rendering for assistant messages
- Optional reasoning display when the selected model emits reasoning deltas
- Optional `web_search` tool backed by Tavily
- Workspace package dependencies for unpublished Anvia packages

## Setup

```sh
pnpm install
cp .env.example .env
```

Fill in `.env`:

```env
OPENROUTER_API_KEY=
ANVIA_MODEL=
TAVILY_API_KEY=
```

`OPENROUTER_API_KEY` is required. `ANVIA_MODEL` is optional. `TAVILY_API_KEY` is optional and enables the `web_search` tool.

## Run

```sh
pnpm dev
```

Build and run the compiled CLI:

```sh
pnpm build
pnpm start
```

After installing globally or linking this package, the CLI command is:

```sh
anvia-cli-agent
```

## Notes

By default the CLI uses OpenRouter with `deepseek/deepseek-v4-pro`.

This is an example application for Anvia, not a production chat client. The message history is kept only in memory and is reset when the process exits.
