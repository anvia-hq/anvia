# fullstack-agent

Minimal full-stack Anvia completion example.

```sh
pnpm fullstack-agent:dev
```

The command loads `../../.env`, builds the local Anvia packages it needs, starts a Hono API server on
`http://127.0.0.1:8787`, and starts the Vite React frontend on `http://127.0.0.1:5177`.

The server runs a real OpenAI-backed completion model with `createCompletionStream`, returns the
completion events with `createEventStream`, and the frontend sends chat-shaped requests with
`useChat` plus the chat primitives from `@anvia/react-ui`.

The composer sends text prompts through the `/api/completion` route as Anvia core messages for
direct model completion.

When `OPENAI_BASEURL` is set, `@anvia/openai` uses the Chat Completions API compatibility path.
