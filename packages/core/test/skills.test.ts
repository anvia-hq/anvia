import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AgentBuilder,
  AssistantContent,
  type CompletionModel,
  type CompletionRequest,
  type CompletionResponse,
  type CompletionStreamEvent,
  createHook,
  loadSkills,
  SkillValidationError,
  type StreamingCompletionModel,
  skill,
  ToolSet,
  Usage,
} from "../src/index";

const tempDirs: string[] = [];

class QueueModel implements CompletionModel {
  readonly provider = "test";
  readonly defaultModel = "test";
  readonly capabilities = {
    streaming: false,
    tools: true,
    toolChoice: true,
    imageInput: true,
    documentInput: true,
    outputSchema: true,
    reasoning: true,
  };
  readonly requests: CompletionRequest[] = [];

  constructor(private readonly responses: CompletionResponse[]) {}

  async completion(request: CompletionRequest): Promise<CompletionResponse> {
    this.requests.push(request);
    const response = this.responses.shift();
    if (response === undefined) {
      throw new Error("No queued response");
    }
    return response;
  }
}

class StreamingQueueModel implements StreamingCompletionModel {
  readonly provider = "test";
  readonly defaultModel = "test";
  readonly capabilities = {
    streaming: true,
    tools: true,
    toolChoice: true,
    imageInput: true,
    documentInput: true,
    outputSchema: true,
    reasoning: true,
  };
  readonly requests: CompletionRequest[] = [];

  constructor(private readonly responses: CompletionStreamEvent[][]) {}

  async completion(): Promise<CompletionResponse> {
    throw new Error("completion should not be called");
  }

  async *streamCompletion(request: CompletionRequest): AsyncIterable<CompletionStreamEvent> {
    this.requests.push(request);
    const response = this.responses.shift();
    if (response === undefined) {
      throw new Error("No queued response");
    }
    yield* response;
  }
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("skills", () => {
  it("loads a single local skill directory", async () => {
    const root = await tempRoot();
    const directory = await writeSkill(root, "code-review", {
      description: "Review code for correctness.",
      referenceFiles: { "guide.md": "Prefer clear findings." },
      scriptFiles: { "lint.sh": "#!/bin/sh\necho lint\n" },
    });

    const skillSet = await loadSkills(skill.local(directory));

    expect(skillSet.skills).toMatchObject([
      {
        name: "code-review",
        description: "Review code for correctness.",
        references: ["guide.md"],
        scripts: ["lint.sh"],
      },
    ]);
    expect(skillSet.instructions).toContain("- code-review: Review code for correctness.");
    expect(skillSet.instructions).toContain("references: guide.md");
    expect(skillSet.instructions).toContain("scripts: lint.sh");
    expect(skillSet.tools.map((tool) => tool.name)).toEqual([
      "get_skill_instructions",
      "get_skill_reference",
      "get_skill_script",
      "run_skill_script",
    ]);
  });

  it("loads multiple skill directories and lets later loaders win duplicates", async () => {
    const first = await tempRoot();
    const second = await tempRoot();
    await writeSkill(first, "duplicate", { description: "First version." });
    await writeSkill(second, "duplicate", { description: "Second version." });
    await writeSkill(second, "testing", { description: "Testing guidance." });

    const skillSet = await loadSkills([skill.local(first), skill.local(second)]);

    expect(skillSet.skills.map((item) => `${item.name}:${item.description}`)).toEqual([
      "duplicate:Second version.",
      "testing:Testing guidance.",
    ]);
  });

  it("rejects invalid skill frontmatter", async () => {
    const root = await tempRoot();
    const bad = join(root, "BadName");
    await mkdir(bad, { recursive: true });
    await writeFile(
      join(bad, "SKILL.md"),
      "---\nname: BadName\ndescription: Bad name\n---\n# Bad\n",
    );

    await expect(loadSkills(skill.local(bad))).rejects.toBeInstanceOf(SkillValidationError);
    await expect(loadSkills(skill.local(bad))).rejects.toMatchObject({
      issues: expect.arrayContaining([
        expect.objectContaining({
          message: "name must contain lowercase letters, numbers, and hyphens only",
        }),
      ]),
    });
  });

  it("reads skill instructions, references, and scripts", async () => {
    const root = await tempRoot();
    await writeSkill(root, "review", {
      description: "Review things.",
      body: "# Review\nUse direct feedback.",
      referenceFiles: { "guide.md": "Reference text" },
      scriptFiles: { "helper.sh": "#!/bin/sh\necho helper\n" },
    });
    const skillSet = await loadSkills(skill.local(root));
    const toolSet = new ToolSet().addTools(skillSet.tools);

    await expect(
      toolSet.call("get_skill_instructions", JSON.stringify({ skillName: "review" })),
    ).resolves.toBe("# Review\nUse direct feedback.");
    await expect(
      toolSet.call(
        "get_skill_reference",
        JSON.stringify({ skillName: "review", referencePath: "guide.md" }),
      ),
    ).resolves.toBe("Reference text");
    await expect(
      toolSet.call(
        "get_skill_script",
        JSON.stringify({ skillName: "review", scriptPath: "helper.sh" }),
      ),
    ).resolves.toBe("#!/bin/sh\necho helper\n");
  });

  it("executes skill scripts and reports failures", async () => {
    const root = await tempRoot();
    await writeSkill(root, "scripts", {
      description: "Run scripts.",
      scriptFiles: {
        "ok.sh": "#!/bin/sh\necho stdout:$1\necho stderr:$2 >&2\n",
        "fail.sh": "#!/bin/sh\necho no >&2\nexit 2\n",
        "slow.sh": "#!/bin/sh\nsleep 2\n",
      },
    });
    const skillSet = await loadSkills(skill.local(root));
    const toolSet = new ToolSet().addTools(skillSet.tools);

    await expect(
      toolSet.call(
        "run_skill_script",
        JSON.stringify({
          skillName: "scripts",
          scriptPath: "ok.sh",
          args: ["one", "two"],
        }),
      ),
    ).resolves.toBe("stdout:\nstdout:one\n\n\nstderr:\nstderr:two\n");
    await expect(
      toolSet.call(
        "run_skill_script",
        JSON.stringify({ skillName: "scripts", scriptPath: "fail.sh" }),
      ),
    ).rejects.toThrow("Skill script exited with code 2");
    await expect(
      toolSet.call(
        "run_skill_script",
        JSON.stringify({ skillName: "scripts", scriptPath: "slow.sh", timeoutMs: 50 }),
      ),
    ).rejects.toThrow("Skill script timed out after 50ms");
  });

  it("rejects skill path traversal", async () => {
    const root = await tempRoot();
    await writeSkill(root, "review", {
      description: "Review things.",
      referenceFiles: { "guide.md": "Reference text" },
    });
    const skillSet = await loadSkills(skill.local(root));
    const toolSet = new ToolSet().addTools(skillSet.tools);

    await expect(
      toolSet.call(
        "get_skill_reference",
        JSON.stringify({ skillName: "review", referencePath: "../SKILL.md" }),
      ),
    ).rejects.toThrow("Invalid skill path");
  });

  it("adds skill instructions and tools to send runs", async () => {
    const root = await tempRoot();
    await writeSkill(root, "review", {
      description: "Review things.",
      body: "# Review\nUse direct feedback.",
    });
    const skillSet = await loadSkills(skill.local(root));
    const model = new QueueModel([
      response([
        AssistantContent.toolCall("call_1", "get_skill_instructions", { skillName: "review" }),
      ]),
      response([AssistantContent.text("loaded")]),
    ]);
    const events: string[] = [];
    const agent = new AgentBuilder("test-agent", model)
      .instructions("Base instructions.")
      .skills(skillSet)
      .hook(
        createHook({
          onToolCall({ toolName }) {
            events.push(`call:${toolName}`);
          },
          onToolResult({ toolName, result }) {
            events.push(`result:${toolName}:${result}`);
          },
        }),
      )
      .defaultMaxTurns(1)
      .build();

    await expect(agent.prompt("review").send()).resolves.toMatchObject({ output: "loaded" });

    expect(model.requests[0]?.instructions).toEqual(
      expect.stringContaining("Base instructions.\n\nYou have access to Agent Skills."),
    );
    expect(model.requests[0]?.tools.map((tool) => tool.name)).toContain("get_skill_instructions");
    expect(events).toEqual([
      "call:get_skill_instructions",
      "result:get_skill_instructions:# Review\nUse direct feedback.",
    ]);
  });

  it("adds skill tools to streaming runs", async () => {
    const root = await tempRoot();
    await writeSkill(root, "review", {
      description: "Review things.",
      body: "# Review\nUse direct feedback.",
    });
    const skillSet = await loadSkills(skill.local(root));
    const model = new StreamingQueueModel([
      [
        {
          type: "tool_call_delta",
          id: "call_1",
          name: "get_skill_instructions",
          argumentsDelta: '{"skillName":"review"}',
        },
      ],
      [{ type: "text_delta", delta: "loaded" }],
    ]);
    const agent = new AgentBuilder("test-agent", model).skills(skillSet).defaultMaxTurns(1).build();

    const events = await collect(agent.prompt("review").stream());

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_result",
        toolName: "get_skill_instructions",
        result: "# Review\nUse direct feedback.",
      }),
    );
    expect(events.at(-1)).toMatchObject({ type: "final", output: "loaded" });
    expect(model.requests[0]?.tools.map((tool) => tool.name)).toContain("get_skill_instructions");
  });
});

function response(choice: CompletionResponse["choice"]): CompletionResponse {
  return {
    choice,
    usage: Usage.empty(),
    rawResponse: {},
  };
}

async function collect<T>(events: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const event of events) {
    result.push(event);
  }
  return result;
}

async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "anvia-skills-"));
  tempDirs.push(dir);
  return dir;
}

async function writeSkill(
  root: string,
  name: string,
  options: {
    description: string;
    body?: string | undefined;
    referenceFiles?: Record<string, string> | undefined;
    scriptFiles?: Record<string, string> | undefined;
  },
): Promise<string> {
  const directory = join(root, name);
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${options.description}\n---\n${options.body ?? `# ${name}`}\n`,
  );

  for (const [path, text] of Object.entries(options.referenceFiles ?? {})) {
    const file = join(directory, "references", path);
    await mkdir(join(file, ".."), { recursive: true });
    await writeFile(file, text);
  }

  for (const [path, text] of Object.entries(options.scriptFiles ?? {})) {
    const file = join(directory, "scripts", path);
    await mkdir(join(file, ".."), { recursive: true });
    await writeFile(file, text);
    await chmod(file, 0o755);
  }

  return directory;
}
