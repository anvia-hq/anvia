# fullstack-agent

Minimal full-stack Anvia agent example.

```sh
pnpm fullstack-agent:dev
```

The command loads `../../.env`, builds the local Anvia packages it needs, starts a Hono API server on
`http://127.0.0.1:8787`, and starts the Vite React frontend on `http://127.0.0.1:5177`.

The server runs a real OpenAI-backed `AgentBuilder` agent, returns the agent events with
`createEventStream`, and the frontend renders them with `@anvia/react` plus `@anvia/react-ui`.

The composer supports text, image attachments, and PDF attachments. Selected or dropped files are
converted into UI message attachments by `@anvia/react-ui`, serialized by `@anvia/react`, and passed
through the `/api/chat` route as Anvia core messages for the agent.

When `OPENAI_BASEURL` is set, `@anvia/openai` uses the Chat Completions API compatibility path.
That path supports image inputs, but PDF file inputs require the default OpenAI Responses API path.
