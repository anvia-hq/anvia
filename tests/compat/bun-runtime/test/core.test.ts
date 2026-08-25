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
});

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
