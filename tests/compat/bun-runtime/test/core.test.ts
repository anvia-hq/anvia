import { afterEach, describe, expect, it } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent, generateCompletion, loadSkills, skill, streamCompletion, Usage } from "@anvia/core";
import { toReadableStream } from "@anvia/core/streaming";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("@anvia/core under Bun", () => {
  it("runs direct and streaming completions through built package exports", async () => {
    const model = createCompletionModel();

    const completion = await generateCompletion({ model, prompt: "hello" });
    const events = await collect(streamCompletion({ model, prompt: "hello" }));

    expect(completion.text).toBe("Hello from Bun");
    expect(events).toEqual([
      { type: "text_delta", delta: "Hello from " },
      { type: "text_delta", delta: "Bun" },
      expect.objectContaining({
        type: "final",
        result: expect.objectContaining({ text: "Hello from Bun" }),
      }),
    ]);
  });

  it("converts async events to a Web ReadableStream", async () => {
    const events = (async function* () {
      yield { type: "text_delta", delta: "one" };
      yield { type: "text_delta", delta: "two" };
    })();

    const body = await new Response(toReadableStream(events)).text();

    expect(body).toBe('{"type":"text_delta","delta":"one"}\n{"type":"text_delta","delta":"two"}\n');
  });

  it("loads a local skill and executes its script with Node-compatible APIs", async () => {
    const root = await mkdtemp(join(tmpdir(), "anvia-bun-core-"));
    tempDirectories.push(root);
    const directory = join(root, "bun-check");
    const scriptsDirectory = join(directory, "scripts");
    await mkdir(scriptsDirectory, { recursive: true });
    await writeFile(
      join(directory, "SKILL.md"),
      "---\nname: bun-check\ndescription: Check Bun runtime compatibility.\n---\nRun the check.\n",
    );
    const scriptPath = join(scriptsDirectory, "check.sh");
    await writeFile(scriptPath, "#!/bin/sh\nprintf 'runtime:%s\\n' \"$1\"\n");
    await chmod(scriptPath, 0o755);

    const skillSet = await loadSkills(skill.local(directory));
    const agent = new Agent({
      id: "bun-compat",
      model: createCompletionModel(),
      tools: skillSet.tools,
    });

    await expect(
      agent.callTool(
        "run_skill_script",
        JSON.stringify({
          skillName: "bun-check",
          scriptPath: "check.sh",
          args: ["bun"],
        }),
      ),
    ).resolves.toEqual({ type: "text", value: "stdout:\nruntime:bun\n" });
  });
  it("emits an error frame when the event iterator throws", async () => {
    const events = (async function* () {
      yield { type: "text_delta", delta: "one" };
      throw new Error("iterator failed");
    })();

    const body = await new Response(toReadableStream(events)).text();
    const lines = body.split("\n").filter((line) => line.length > 0);

    expect(lines).toHaveLength(2);
    const firstLine = lines[0];
    const errorLine = lines[1];
    if (firstLine === undefined || errorLine === undefined) {
      throw new Error("Expected an event line and an error line");
    }
    expect(JSON.parse(firstLine)).toEqual({ type: "text_delta", delta: "one" });
    expect(JSON.parse(errorLine)).toMatchObject({
      type: "error",
      error: { name: "Error", message: "iterator failed" },
    });
  });

  it("propagates consumer cancellation to the event iterator", async () => {
    let finalized = false;
    const events = (async function* () {
      try {
        let index = 0;
        while (true) {
          yield { type: "text_delta", delta: `tick-${index}` };
          index += 1;
        }
      } finally {
        finalized = true;
      }
    })();

    const reader = toReadableStream(events).getReader();
    expect((await reader.read()).done).toBe(false);
    await reader.cancel();

    expect(finalized).toBe(true);
  });

  it("rejects when a skill script exceeds its timeout under Bun", async () => {
    const directory = await createSkillDirectory(
      "bun-timeout",
      "slow.sh",
      "#!/bin/sh\nwhile true; do :; done\n",
    );
    const skillSet = await loadSkills(skill.local(directory));
    const agent = new Agent({
      id: "bun-timeout",
      model: createCompletionModel(),
      tools: skillSet.tools,
    });

    await expect(
      agent.callTool(
        "run_skill_script",
        JSON.stringify({
          skillName: "bun-timeout",
          scriptPath: "slow.sh",
          timeoutMs: 100,
        }),
      ),
    ).rejects.toThrow("Skill script timed out after 100ms");
  });

  it("reports non-zero skill script exits with captured stderr", async () => {
    const directory = await createSkillDirectory(
      "bun-fail",
      "fail.sh",
      '#!/bin/sh\necho "starting"\necho "broken" >&2\nexit 3\n',
    );
    const skillSet = await loadSkills(skill.local(directory));
    const agent = new Agent({
      id: "bun-fail",
      model: createCompletionModel(),
      tools: skillSet.tools,
    });

    await expect(
      agent.callTool(
        "run_skill_script",
        JSON.stringify({ skillName: "bun-fail", scriptPath: "fail.sh" }),
      ),
    ).rejects.toThrow("Skill script exited with code 3: stdout:\nstarting\n\n\nstderr:\nbroken\n");
  });

  it("truncates oversized skill script output", async () => {
    const directory = await createSkillDirectory(
      "bun-truncate",
      "flood.sh",
      "#!/bin/sh\nawk 'BEGIN { for (i = 0; i < 25000; i++) printf \"-\" }'\n",
    );
    const skillSet = await loadSkills(skill.local(directory));
    const agent = new Agent({
      id: "bun-truncate",
      model: createCompletionModel(),
      tools: skillSet.tools,
    });

    await expect(
      agent.callTool(
        "run_skill_script",
        JSON.stringify({ skillName: "bun-truncate", scriptPath: "flood.sh" }),
      ),
    ).resolves.toEqual({ type: "text", value: `stdout:\n${"-".repeat(20_000)}\n[truncated]` });
  });
});

async function createSkillDirectory(
  name: string,
  scriptName: string,
  script: string,
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "anvia-bun-core-"));
  tempDirectories.push(root);
  const directory = join(root, name);
  const scriptsDirectory = join(directory, "scripts");
  await mkdir(scriptsDirectory, { recursive: true });
  await writeFile(
    join(directory, "SKILL.md"),
    `---\nname: ${name}\ndescription: Bun compatibility fixture.\n---\nRun the fixture.\n`,
  );
  const scriptPath = join(scriptsDirectory, scriptName);
  await writeFile(scriptPath, script);
  await chmod(scriptPath, 0o755);
  return directory;
}

function createCompletionModel() {
  return {
    provider: "bun-compat",
    modelId: "bun-compat",
    capabilities: {
      streaming: true,
      tools: true,
      toolChoice: true,
      imageInput: true,
      documentInput: true,
      outputSchema: true,
      reasoning: true,
    },
    async completion() {
      return completionResponse("Hello from Bun");
    },
    async *streamCompletion() {
      yield { type: "text_delta" as const, delta: "Hello from " };
      yield { type: "text_delta" as const, delta: "Bun" };
      yield {
        type: "final" as const,
        response: { ...completionResponse("Hello from Bun"), finishReason: "stop" as const },
      };
    },
  };
}

function completionResponse(text: string) {
  return {
    choice: [{ type: "text" as const, text }],
    usage: Usage.empty(),
    rawResponse: {},
  };
}

async function collect<T>(events: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const event of events) values.push(event);
  return values;
}
