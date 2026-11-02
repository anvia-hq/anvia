Ship this thread's work as one pull request against `main`.

One pull request holds one deliverable. If the thread produced several
independent deliverables, ship only the first one here and say what is left.

1. Commit the work in small, scoped commits on this branch. Commit titles use
   Conventional Commits with a package scope, matching repo history, e.g.
   `feat(react-ui): add renderEntity to ComposerPrimitive.Input`,
   `fix(core): correct compaction temperature default`,
   `docs(studio): clarify desktop wiring status`.
   Never commit secrets, API keys, `.env` files, `dist/`, or `node_modules/`.
   Only touch `pnpm-lock.yaml` when dependencies actually changed.
2. If the change alters published behavior of any package in `packages/`
   (fix, feature, or package README meant for npm), add a changeset file
   `.changeset/<short-name>.md` in the same commit, e.g.:
   `---\n"@anvia/core": patch\n---\n\nFix the compaction temperature default.`
   Use `minor` for new backwards-compatible APIs, `major` for breaking
   changes. Skip the changeset for repo-only docs, CI, examples, or private
   workspaces.
3. Update from the default branch: `git fetch origin main && git rebase origin/main`.
   Resolve conflicts in favor of a working tree, then continue the rebase.
   Never force-push `main`. If the rebase rewrote this branch after it was
   already pushed, push back with `git push --force-with-lease`.
4. Run the same validation CI runs, in this order. If a step fails because of
   your change, fix it and re-run from the failed step. If it fails on code
   you did not touch, stop and tell me instead of working around it:
   `pnpm check && pnpm build && pnpm typecheck && pnpm test`
   If you added or edited files under `.changeset/`, also run
   `pnpm releases:validate`.
5. Push the branch: `git push -u origin HEAD`. If a pull request already
   exists for this branch, this push updates it and you are done after
   re-checking its CI status with `gh pr checks`.
6. For visible Studio UI changes only: capture a screenshot or short
   recording of the changed view, save it under `.aven/proof/`, commit and
   push it, and link it from the pull request body. Other changes need no
   proof files beyond the check output.
7. Open a draft pull request against `main` (skip if one already exists):
   `gh pr create --draft --base main --title "<conventional-commit title>" --body "<body>"`.
   The title is one Conventional Commit line for the whole deliverable. The
   body has: a short summary of what changed and why; the validation commands
   you ran and their result; the changeset bump if any; known limitations or
   follow-ups. Do not include internal links or customer names.
8. Do not merge the pull request and do not enable auto-merge. Merging is
   done by a person. Report the pull request URL and the checks status.
