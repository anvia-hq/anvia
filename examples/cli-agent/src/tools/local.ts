import { exec } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { createTool } from "@anvia/core/tool";
import { z } from "zod";
import { ensureTempWorkspace, resolveTempPath, TEMP_WORKSPACE_DIR } from "../workspace.js";

const execAsync = promisify(exec);

type WriteFileArgs = {
  path: string;
  content: string;
};

type UpdateFileArgs = {
  path: string;
  oldText: string;
  newText: string;
  replaceAll?: boolean;
};

type ExecCommandArgs = {
  command: string;
  timeoutMs?: number;
};

const writeFileInput = z.object({
  path: z.string().min(1).describe("Relative path inside .tmp to write."),
  content: z.string().describe("Complete file content."),
}) as z.ZodType<WriteFileArgs>;

const updateFileInput = z.object({
  path: z.string().min(1).describe("Relative path inside .tmp to update."),
  oldText: z.string().min(1).describe("Existing text to replace."),
  newText: z.string().describe("Replacement text."),
  replaceAll: z.boolean().optional().describe("Replace all matches instead of the first match."),
}) as z.ZodType<UpdateFileArgs>;

const execCommandInput = z.object({
  command: z.string().min(1).describe("Shell command to run from the .tmp directory."),
  timeoutMs: z
    .number()
    .int()
    .positive()
    .max(60_000)
    .optional()
    .describe("Optional timeout in milliseconds. Maximum 60000."),
}) as z.ZodType<ExecCommandArgs>;

const textOutput = z.string() as z.ZodType<string>;

export function createLocalWorkspaceTools() {
  return [createWriteFileTool(), createUpdateFileTool(), createExecCommandTool()];
}

function createWriteFileTool() {
  return createTool({
    name: "write_file",
    description: "Write a file inside the local .tmp workspace. Creates parent directories.",
    input: writeFileInput,
    output: textOutput,
    execute: async ({ path: filePath, content }) => {
      const targetPath = await resolveTempPath(filePath);
      await mkdir(path.dirname(targetPath), { recursive: true });
      await writeFile(targetPath, content, "utf8");
      return `Wrote ${path.relative(TEMP_WORKSPACE_DIR, targetPath)}`;
    },
  });
}

function createUpdateFileTool() {
  return createTool({
    name: "update_file",
    description:
      "Update a file inside the local .tmp workspace by replacing existing text with new text.",
    input: updateFileInput,
    output: textOutput,
    execute: async ({ path: filePath, oldText, newText, replaceAll }) => {
      const targetPath = await resolveTempPath(filePath);
      const currentContent = await readFile(targetPath, "utf8");

      if (!currentContent.includes(oldText)) {
        throw new Error(`Text to replace was not found in ${filePath}.`);
      }

      const nextContent =
        replaceAll === true
          ? currentContent.split(oldText).join(newText)
          : currentContent.replace(oldText, newText);

      await writeFile(targetPath, nextContent, "utf8");
      return `Updated ${path.relative(TEMP_WORKSPACE_DIR, targetPath)}`;
    },
  });
}

function createExecCommandTool() {
  return createTool({
    name: "exec_command",
    description: "Run a shell command from the local .tmp workspace and return stdout/stderr.",
    input: execCommandInput,
    output: textOutput,
    execute: async ({ command, timeoutMs }) => {
      await ensureTempWorkspace();
      const { stdout, stderr } = await execAsync(command, {
        cwd: TEMP_WORKSPACE_DIR,
        timeout: timeoutMs ?? 15_000,
        maxBuffer: 1024 * 1024,
      });

      return formatCommandOutput(stdout, stderr);
    },
  });
}

function formatCommandOutput(stdout: string, stderr: string) {
  const parts: string[] = [];

  if (stdout.length > 0) {
    parts.push(`stdout:\n${stdout.trimEnd()}`);
  }

  if (stderr.length > 0) {
    parts.push(`stderr:\n${stderr.trimEnd()}`);
  }

  return parts.length > 0 ? parts.join("\n\n") : "Command completed with no output.";
}
