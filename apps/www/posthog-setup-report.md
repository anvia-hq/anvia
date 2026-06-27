# PostHog post-wizard report

The wizard has completed a deep integration of PostHog analytics into the Anvia website. A `src/components/posthog.astro` initialization component was created and wired into all three page roots (`src/pages/index.astro`, `src/pages/sponsors.astro`, `src/components/docs/DocsShell.astro`). Ten custom events were instrumented across five files using `is:inline` scripts and data attributes, covering homepage CTA clicks, package install command copies, docs search interactions, package catalog exploration, and sponsor page engagement. Environment variables for the PostHog token and host are stored in `.env` and referenced via `import.meta.env`.

## Events

| Event name | Description | File |
|---|---|---|
| `hero_cta_clicked` | User clicks a primary or secondary CTA button in the hero section of the homepage. | `src/components/Hero.astro` |
| `gateway_cta_clicked` | User clicks a CTA button in the Agent Gateway feature section on the homepage. | `src/components/AgentGateway.astro` |
| `install_command_copied` | User copies a package install command to the clipboard from the package map section. | `src/components/PackageMap.astro` |
| `docs_searched` | User submits a search query in the docs search dialog. | `src/components/docs/DocsSearch.astro` |
| `docs_search_result_clicked` | User clicks on a search result from the docs search dialog. | `src/components/docs/DocsSearch.astro` |
| `package_install_command_copied` | User copies a package install command from a package card in the full package catalog. | `src/pages/docs/packages.astro` |
| `package_overview_clicked` | User clicks the Overview link to open a specific package's documentation. | `src/pages/docs/packages.astro` |
| `package_getting_started_clicked` | User clicks the Getting Started link for a package in the package catalog. | `src/pages/docs/packages.astro` |
| `sponsor_link_clicked` | User clicks through to a sponsor's external website from the sponsors page. | `src/pages/sponsors.astro` |
| `become_sponsor_clicked` | User clicks the 'Become a sponsor' CTA to initiate contact about sponsorship. | `src/pages/sponsors.astro` |

## Next steps

We've built some insights and a dashboard for you to keep an eye on user behavior, based on the events we just instrumented:

- [Analytics basics (wizard) — Dashboard](https://us.posthog.com/project/488187/dashboard/1767901)
- [CTA engagement (wizard)](https://us.posthog.com/project/488187/insights/NGVFj4WL)
- [Install command copies (wizard)](https://us.posthog.com/project/488187/insights/LEFVkt1N)
- [Docs search engagement (wizard)](https://us.posthog.com/project/488187/insights/uUlLSyK6)
- [Package exploration (wizard)](https://us.posthog.com/project/488187/insights/XKLIpr9f)
- [Sponsor page interest (wizard)](https://us.posthog.com/project/488187/insights/0ohcy4rW)

## Verify before merging

- [ ] Run a full production build (the wizard only verified the files it touched) and fix any lint or type errors introduced by the generated code.
- [ ] Run the test suite — call sites that were rewritten or instrumented may need updated mocks or fixtures.
- [ ] Add `PUBLIC_POSTHOG_PROJECT_TOKEN` and `PUBLIC_POSTHOG_HOST` to `.env.example` and any monorepo/bootstrap scripts so collaborators know what to set.
- [ ] Wire source-map upload (`posthog-cli sourcemap` or your bundler's upload step) into CI so production stack traces de-minify.

### Agent skill

We've left an agent skill folder in your project. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.
