# Tools

Tools are created with `createTool` from `@anvia/core/tool`. Every tool needs a
`name`, a routing `description`, a zod `inputSchema`, and an `execute`
implementation. Input and output are validated at the boundary — describe every
schema field so the model fills it correctly.

```ts
const tool = createTool({
  name: "add",
  description: "Add two numbers together.",
  inputSchema: z.object({
    x: z.number().describe("The first number."),
    y: z.number().describe("The second number."),
  }),
  outputSchema: z.number(), // optional; when present, execute results are parsed against it
  execute: (args) => args.x + args.y,
});
```

## Approvals

Side-effecting tools declare `requiresApproval` — a boolean, a static
`{ reason }`, or a function of the args. Approval requests suspend the run;
resume it explicitly:

```ts
const tool = createTool({
  name: "delete_account",
  description: "Delete a customer account permanently.",
  inputSchema: z.object({ accountId: z.string() }),
  outputSchema: z.string(),
  requiresApproval: ({ accountId }) => ({ reason: `Permanently delete ${accountId}?` }),
  execute: ({ accountId }) => `Deleted account ${accountId}`,
});

let result = await agent.generate({ prompt: "..." });
while (result.type === "interaction") {
  // result.interaction is e.g. { type: "tool-approval", toolName, reason }
  result = await agent.resume(result.continuation, {
    type: "tool-approval",
    approved: false,
    reason: "Reject sensitive operations in this demo.",
  });
}
```

Always handle the `interaction` result shape — `generate` does not throw for
approvals. The same interaction loop applies to `createQuestionTool` prompts.

## Built-in and dynamic tools

- `createThinkTool()` — a scratchpad reasoning tool for agents that need visible
  intermediate thought.
- `createQuestionTool()` — ask the caller a question mid-run (resolves through
  the interaction loop like approvals).
- `ToolIndex` — expose a large or dynamic tool set behind one entry so the Agent
  resolves tools at call time instead of listing them all in the prompt.
- `createMiddleware()` — observe or map around requests, responses, and tool
  input/output; prefer it over re-implementing retry or mapping inside
  `execute`.
- `createHook()` (from `@anvia/core/internal/agent`) — lifecycle actions
  (continue, skip, terminate, approval). Per-run tool concurrency is the
  `toolConcurrency` setting, not a middleware or hook concern.

## MCP tools

MCP tools must be registered through `Agent.mcpServers`, never smuggled in via
`Agent.skills`. Skill tooling (`get_skill_instructions`, `get_skill_reference`,
`get_skill_script`, `run_skill_script`) is created by `loadSkills` and merged by
the Agent itself — pass the `SkillSet`, not its individual tools.
