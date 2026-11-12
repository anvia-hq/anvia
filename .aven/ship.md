Ship this thread's work as one pull request against `main`.

One pull request holds one deliverable. If the thread produced several
independent deliverables, ship only the first one here and say what is left.

Repository: `anvia-hq/anvia` (public). The `origin` remote in this workspace is
a local path, so `gh` cannot infer the repository: pass `-R anvia-hq/anvia` on
every `gh` command. CI is `.github/workflows/ci.yml`.

1. Commit the work in small, scoped commits on this branch. Titles use
   Conventional Commits with a package scope, matching repo history, e.g.
   `feat(durable): record control hook decisions`,
   `fix(studio): bound the JSON request body size`,
   `docs(durable): document per-registration toolConcurrency`,
   `chore(deps): refresh security overrides`.
   Never commit secrets, API keys, `.env` files, `dist/`, `node_modules/`, or
   coverage output. Only touch `pnpm-lock.yaml` when dependencies actually
   changed; never edit it by hand.
2. If the change alters published behavior of any package in `packages/`
   (fix, feature, or a package README meant for npm), add a changeset in the
   same commit: `.changeset/<short-name>.md` with a frontmatter block naming
   the package and a `patch` or `minor` bump, then a one-line summary.
   Majors are prohibited for every package; never write `major`. Skip the
   changeset for repo-only docs, CI, cookbook, or other private workspaces.
3. Update from the default branch: `git fetch origin main && git rebase origin/main`.
   Resolve conflicts so the tree still works, then continue the rebase. Never
   force-push `main`; if the rebase rewrote this branch after a push, push it
   back with `git push --force-with-lease`.
4. Run the same checks CI runs, in this order, from the repository root:
   `pnpm check && pnpm build && pnpm typecheck && pnpm test`
   Also run `pnpm releases:validate` when the branch adds or edits files under
   `.changeset/`, and `node --test scripts/oxlint-anvia.test.mjs` when it
   touches `scripts/oxlint-anvia*`.
   If a step fails because of your change, fix it and re-run from that step. If
   it fails on code you did not touch, stop and tell me what failed instead of
   working around it or weakening the check.
   The CI Postgres and Bun jobs are not run locally: they need a PostgreSQL 17
   service and a second runtime. Do not claim they were run.
5. Push the branch: `git push -u origin HEAD`. If a pull request already exists
   for this branch, this push updates it, and you are done after checking its
   checks with `gh pr checks -R anvia-hq/anvia <number>`.
6. Proof, for a visible Studio UI change only: capture a screenshot or a short
   recording of the changed view (Playwright is not installed here; use the
   browser in the sandbox, or `ffmpeg` for a recording), save the file under
   `.aven/proof/`, commit and push it, and link it from the pull request under
   "How it was tested". If no visual verification was possible, say so plainly
   in the body instead of leaving it out.
   Other changes need no proof files.
7. Open the pull request ready for review, not as a draft:
   `gh pr create -R anvia-hq/anvia --base main --title "<one Conventional Commit line>" --body "<body>"`
   The title is one Conventional Commit line for the whole deliverable; it
   becomes the squash commit, so it must read as the change.
   The body has: what changed and why in a short summary; the validation
   commands you ran and their result; the changeset bump, if any; a link to the
   proof files for a Studio UI change; known limitations, skipped checks or
   follow-ups.
   There is no pull request template and the repo uses no labels: do not invent
   labels, assignees or reviewers, and do not link issues I did not name. Keep
   internal links and customer names out of the body.
8. A `review` check (`Hammer Review`, `.github/workflows/hammer.yml`) posts an
   automated review on the pull request. Read it: fix or answer real findings,
   and leave the rest with a short reason.
9. Do not merge the pull request, do not enable auto-merge, and do not run
   publish, preview-release, GitHub-release, deploy or Discord commands.
   Merging is done by a person. Report the pull request URL and the checks
   status.
