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

## Updating installed components

`update` compares the Anvia components in your project against the current registry:

```sh
pnpm dlx @anvia/cli update            # check every item (preview only, writes nothing)
pnpm dlx @anvia/cli update composer   # check a single item
pnpm dlx @anvia/cli update --overwrite
```

Without `--overwrite`, `update` is a preview: it reports each file as `up-to-date`,
`modified` (the installed copy differs from the registry), or `missing`. Pass `--overwrite`
to write the registry content over out-of-date and missing files. Locally edited copies are
overwritten, so commit or stash your changes first.
