---
"@anvia/core": minor
---

Allow `createQuestionTool()` without options, defaulting to `ask_user` and built-in instructions
for asking necessary questions. Export `DEFAULT_QUESTION_TOOL_NAME` and
`DEFAULT_QUESTION_TOOL_DESCRIPTION` from the tool and root entrypoints.

Validate new tool inputs as 1–4 questions with unique IDs and optional 2–4 choices with unique
values, with clear errors for blank fields. Stored interaction requests and continuations retain
their existing parsing rules, and response validation continues to require one valid answer per
question.
