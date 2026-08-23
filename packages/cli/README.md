# @anvia/cli

Install editable, app-owned UI components on top of the headless `@anvia/react-ui` primitives.

```sh
pnpm dlx @anvia/cli init vite
pnpm dlx @anvia/cli add chat
```

`init` configures shadcn in an existing Next.js or Vite application. It does not create an app.
`add` writes components below the `components` alias from `components.json` (normally
`src/components/anvia`) and installs the matching `@anvia/react-ui` release.

Available items: `chat`, `thread`, `message`, `composer`, `attachment`, `markdown`, and
`tool-fallback`.
