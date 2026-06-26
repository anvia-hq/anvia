---
title: Skills
description: Load reusable instructions and skill-provided tools.
section: advanced
sidebar:
  group: Knowledge and retrieval
  order: 35
---

Skills package reusable instructions, references, and scripts so an agent can load deeper guidance only when it is relevant. They are not the same as RAG documents. RAG retrieves facts. Skills provide capability guidance and optional skill tools.

Use skills for workflows such as code review, release notes, migration playbooks, design checks, or internal operating procedures that have a stable instruction package.

## Skill Directory Shape

A local skill is a directory with `SKILL.md`:

```txt
skills/
  release-notes/
    SKILL.md
    references/
      style-guide.md
    scripts/
      draft.sh
```

`SKILL.md` starts with YAML frontmatter:

```md
---
name: release-notes
description: Draft release notes from product changes.
---

# Release Notes

Use the reference style guide before drafting.
```

The `name` must match the directory name, use lowercase letters, numbers, and hyphens, and stay short enough to be a stable tool argument.

Optional frontmatter can include `license` and `metadata`. Core exposes those fields on the loaded `Skill`, but it does not decide how your product should enforce licensing, visibility, or environment policy.

## Load Skills

Load skills with `loadSkills(...)` and `skill.local(...)`:

```ts
import { AgentBuilder } from "@anvia/core";
import { loadSkills, skill } from "@anvia/core/skills";

const productSkills = await loadSkills(skill.local("skills"));

const agent = new AgentBuilder("release-assistant", model)
  .instructions("Use skills when they are relevant to the task.")
  .skills(productSkills)
  .defaultMaxTurns(4)
  .build();
```

If the path points at one skill directory, core loads that skill. If the path points at a directory containing many skill directories, core loads each child directory that has a `SKILL.md`.

When multiple loaders provide the same skill name, later loaders win. Use that for environment-specific overrides, but keep it explicit in your app setup.

`SkillLoader` is the minimal adapter interface: a loader has `load(): Promise<Skill[]>`. `loadSkills(...)` returns a `SkillSet` with the loaded `skills`, generated `tools`, and combined `instructions`. Use the built-in `skill.local(...)` loader for local directories, or implement `SkillLoader` when skills come from another trusted source.

## What `.skills(...)` Adds

Calling `.skills(skillSet)` adds two things to the agent:

- a generated instruction block listing available skills
- skill tools for loading full instructions, references, scripts, and running scripts

The skill instruction block is appended after normal `.instructions(...)` blocks. See [Instructions](/docs/advanced/instructions-and-context) for how repeated instruction calls are combined.

## Skill Tools

Core creates these tools when at least one skill is loaded:

- `get_skill_instructions`
- `get_skill_reference`
- `get_skill_script`
- `run_skill_script`

The agent sees the skill names, descriptions, reference paths, and script paths. It can then load only the deeper content it needs:

```ts
const request = agent.prompt(
  "Draft release notes for the new streaming and retrieval improvements.",
);

const response = await request.send();
```

The model may call `get_skill_instructions` first, then read a reference or run a script if the skill says to do so.

## References And Scripts

References are read-only files under `references/`. Use them for style guides, examples, policies, rubrics, or checklists.

Scripts are executable files under `scripts/`. Use them for deterministic helpers such as formatting, linting, summarizing local artifacts, or generating a draft from structured input.

Skill tools enforce containment:

- absolute paths are rejected
- path traversal is rejected
- only listed reference and script paths can be read or run
- scripts run with a timeout
- script output is capped

Your application still owns whether scripts are appropriate in a production runtime. In many products, skills should be read-only and scripts should run only in trusted worker environments.

## Validation Errors

Invalid skills throw `SkillValidationError`:

```ts
import { SkillValidationError, loadSkills, skill } from "@anvia/core/skills";

try {
  const skillSet = await loadSkills(skill.local("skills"));
} catch (error) {
  if (error instanceof SkillValidationError) {
    for (const issue of error.issues) {
      console.error(issue.path, issue.message);
    }
  }

  throw error;
}
```

Validate skills at startup or in CI so broken frontmatter does not appear during a user request.

Validation covers directory/name consistency, required frontmatter, name format, and description length. Skill tools enforce containment for reference and script paths, reject unlisted assets, run scripts with a timeout, and cap script output. Keep skills small enough that the model can decide when to load them; put large factual corpora in retrieval instead.

## Skills Versus Retrieval

Use retrieval when the model needs facts from a corpus:

- product documentation
- support articles
- policy records
- customer-safe knowledge
- source excerpts with metadata filters

Use skills when the model needs procedural guidance:

- how to perform a task
- which reference file to read
- which script can help
- what output style or review rubric to apply

They can be used together. A support agent can retrieve policy facts with `.dynamicContext(...)` and use a writing skill for response style. Keep the distinction clear so knowledge updates do not require changing skill instructions, and skill updates do not require re-embedding a corpus.
