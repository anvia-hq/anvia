import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { z } from "zod";
import { type AnyTool, createTool } from "../tool";
import { markSkillTool } from "../tool/skill-tool-marker";
import type { Skill } from "./types";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_CHARS = 20_000;

export function createSkillTools(skills: Skill[]): AnyTool[] {
  const registry = new SkillRegistry(skills);

  return [
    markSkillTool(
      createTool({
        name: "get_skill_instructions",
        description: "Load the full SKILL.md instructions for an Agent Skill.",
        input: z.object({
          skillName: z.string().describe("The name of the skill to load."),
        }),
        output: z.string(),
        execute: ({ skillName }) => registry.get(skillName).instructions,
      }),
    ),
    markSkillTool(
      createTool({
        name: "get_skill_reference",
        description: "Read a reference file from an Agent Skill.",
        input: z.object({
          skillName: z.string().describe("The name of the skill."),
          referencePath: z.string().describe("A path listed in the skill references."),
        }),
        output: z.string(),
        execute: ({ skillName, referencePath }) => registry.readReference(skillName, referencePath),
      }),
    ),
    markSkillTool(
      createTool({
        name: "get_skill_script",
        description: "Read a script file from an Agent Skill.",
        input: z.object({
          skillName: z.string().describe("The name of the skill."),
          scriptPath: z.string().describe("A path listed in the skill scripts."),
        }),
        output: z.string(),
        execute: ({ skillName, scriptPath }) => registry.readScript(skillName, scriptPath),
      }),
    ),
    markSkillTool(
      createTool({
        name: "run_skill_script",
        description: "Execute a script from an Agent Skill with optional arguments.",
        input: z.object({
          skillName: z.string().describe("The name of the skill."),
          scriptPath: z.string().describe("A path listed in the skill scripts."),
          args: z.array(z.string()).optional().describe("Arguments passed to the script."),
          timeoutMs: z.number().int().positive().optional().describe("Execution timeout in ms."),
        }),
        output: z.string(),
        execute: ({ skillName, scriptPath, args = [], timeoutMs = DEFAULT_TIMEOUT_MS }) =>
          registry.runScript(skillName, scriptPath, args, timeoutMs),
      }),
    ),
  ];
}

class SkillRegistry {
  private readonly skills = new Map<string, Skill>();

  constructor(skills: Skill[]) {
    for (const skill of skills) {
      this.skills.set(skill.name, skill);
    }
  }

  get(skillName: string): Skill {
    const skill = this.skills.get(skillName);
    if (skill === undefined) {
      throw new Error(`Skill not found: ${skillName}`);
    }
    return skill;
  }

  async readReference(skillName: string, referencePath: string): Promise<string> {
    const skill = this.get(skillName);
    const path = this.resolveContainedPath(skill, "references", referencePath);
    if (!skill.references.includes(referencePath)) {
      throw new Error(`Skill reference not found: ${skillName}/${referencePath}`);
    }
    return readFile(path, "utf8");
  }

  async readScript(skillName: string, scriptPath: string): Promise<string> {
    const skill = this.get(skillName);
    const path = this.resolveContainedPath(skill, "scripts", scriptPath);
    if (!skill.scripts.includes(scriptPath)) {
      throw new Error(`Skill script not found: ${skillName}/${scriptPath}`);
    }
    return readFile(path, "utf8");
  }

  async runScript(
    skillName: string,
    scriptPath: string,
    args: string[],
    timeoutMs: number,
  ): Promise<string> {
    const skill = this.get(skillName);
    const script = this.resolveContainedPath(skill, "scripts", scriptPath);
    if (!skill.scripts.includes(scriptPath)) {
      throw new Error(`Skill script not found: ${skillName}/${scriptPath}`);
    }
    return runExecutable(script, args, skill.directory, timeoutMs);
  }

  private resolveContainedPath(
    skill: Skill,
    section: "references" | "scripts",
    requestedPath: string,
  ): string {
    if (requestedPath.length === 0 || isAbsolute(requestedPath)) {
      throw new Error(`Invalid skill path: ${requestedPath}`);
    }

    const root = resolve(skill.directory, section);
    const resolved = resolve(root, requestedPath);
    const rel = relative(root, resolved);
    if (rel === ".." || rel.startsWith(`..${"/"}`) || rel.startsWith(`..${"\\"}`)) {
      throw new Error(`Invalid skill path: ${requestedPath}`);
    }

    return resolved;
  }
}

function runExecutable(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout = appendLimited(stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = appendLimited(stderr, chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      if (timedOut) {
        reject(new Error(`Skill script timed out after ${timeoutMs}ms`));
        return;
      }

      const output = formatProcessOutput(stdout, stderr);
      if (code !== 0) {
        reject(new Error(`Skill script exited with code ${code ?? "unknown"}: ${output}`));
        return;
      }
      if (signal !== null) {
        reject(new Error(`Skill script exited with signal ${signal}: ${output}`));
        return;
      }

      resolvePromise(output);
    });
  });
}

function formatProcessOutput(stdout: string, stderr: string): string {
  const parts: string[] = [];
  if (stdout.length > 0) {
    parts.push(`stdout:\n${stdout}`);
  }
  if (stderr.length > 0) {
    parts.push(`stderr:\n${stderr}`);
  }
  return parts.length === 0 ? "" : parts.join("\n\n");
}

function appendLimited(current: string, chunk: string): string {
  const next = current + chunk;
  if (next.length <= MAX_OUTPUT_CHARS) {
    return next;
  }
  return `${next.slice(0, MAX_OUTPUT_CHARS)}\n[truncated]`;
}
