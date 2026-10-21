import type { AnyTool, ToolCallContext } from "@anvia/core/tool";
import type { JsonObject, ToolCallPart } from "@anvia/core/completion";
import { lstat, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { AcpError } from "./errors.js";
import { resolveLimits } from "./limits.js";
import type { PendingRequests } from "./pending-requests.js";
import type { AcpSessionPolicy, AcpToolPresentation } from "./types.js";

/** Protocol-independent client operations, bound to one session at the wire boundary. */
export type EditorClient = {
  read(path: string, signal: AbortSignal): Promise<string>;
  write(path: string, content: string, signal: AbortSignal): Promise<void>;
  create(command: string, args: string[], cwd: string, outputByteLimit: number): Promise<string>;
  wait(
    id: string,
    signal: AbortSignal,
  ): Promise<{ exitCode: number | null; signal: string | null }>;
  output(id: string, signal: AbortSignal): Promise<{ output: string; truncated: boolean }>;
  kill(id: string, signal: AbortSignal): Promise<void>;
  release(id: string, signal: AbortSignal): Promise<void>;
};

const maxBytes = 1024 * 1024;
const pathSchema = { type: "string", minLength: 1 };

export function createEditorTools(
  cwd: string,
  policy: AcpSessionPolicy,
  client: EditorClient | undefined,
  requests: () => PendingRequests,
  terminalOutputBytes = resolveLimits().maxTerminalOutputBytes,
): readonly AnyTool[] {
  if (!client) return Object.freeze([]);
  const tools: AnyTool[] = [];
  function tool(
    name: string,
    description: string,
    properties: JsonObject,
    required: string[],
    execute: (input: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>,
  ): AnyTool {
    function parse(input: unknown): Record<string, unknown> {
      if (!input || typeof input !== "object" || Array.isArray(input))
        throw new AcpError("invalid_content");
      const value = input as Record<string, unknown>;
      if (Object.keys(value).some((key) => !Object.hasOwn(properties, key)))
        throw new AcpError("invalid_content");
      for (const key of required) text(value[key], key !== "content");
      if (
        value.args !== undefined &&
        (!Array.isArray(value.args) ||
          value.args.some((arg) => typeof arg !== "string" || arg.includes("\0")))
      )
        throw new AcpError("invalid_content");
      if (value.cwd !== undefined) text(value.cwd, true);
      return value;
    }
    return Object.freeze({
      name,
      requiresApproval: true,
      definition: () => ({
        name,
        description,
        parameters: {
          type: "object",
          properties: structuredClone(properties),
          required: [...required],
          additionalProperties: false,
        },
      }),
      parseInput: parse,
      async call(input: unknown, context?: ToolCallContext) {
        context?.abortSignal?.throwIfAborted();
        const parsed = parse(input);
        let operation: Promise<unknown> | undefined;
        try {
          return await requests().run((signal) => {
            operation = execute(parsed, signal);
            return operation;
          });
        } finally {
          // Keep execution ownership until terminal creation/cleanup finishes, even
          // when the registry has already rejected cancellation to its caller.
          await operation?.catch(() => undefined);
        }
      },
    });
  }
  if (policy.editorTools.readTextFile)
    tools.push(
      tool(
        "editor_read_text_file",
        "Read a UTF-8 file through the editor, including unsaved buffers.",
        { path: pathSchema },
        ["path"],
        async (input, signal) => {
          const path = await workspacePath(cwd, policy.workspaceRoots, input.path as string);
          signal.throwIfAborted();
          const result = await client.read(path, signal);
          if (Buffer.byteLength(result) > maxBytes) throw new AcpError("resource_limit");
          return result;
        },
      ),
    );
  if (policy.editorTools.writeTextFile)
    tools.push(
      tool(
        "editor_write_text_file",
        "Replace a UTF-8 file through the editor. Requires approval.",
        { path: pathSchema, content: { type: "string" } },
        ["path", "content"],
        async (input, signal) => {
          const path = await workspacePath(cwd, policy.workspaceRoots, input.path as string);
          signal.throwIfAborted();
          await client.write(path, input.content as string, signal);
          return { path };
        },
      ),
    );
  if (policy.editorTools.terminal)
    tools.push(
      tool(
        "editor_run_terminal",
        "Run a command with explicit argv in an editor terminal and wait for exit.",
        {
          command: pathSchema,
          args: { type: "array", items: { type: "string" } },
          cwd: pathSchema,
        },
        ["command"],
        async (input, signal) => {
          const path = await workspacePath(
            cwd,
            policy.workspaceRoots,
            (input.cwd as string | undefined) ?? ".",
          );
          signal.throwIfAborted();
          // Do not cancel create: a late response still owns a terminal that must be released.
          const id = await client.create(
            input.command as string,
            (input.args as string[] | undefined) ?? [],
            path,
            terminalOutputBytes,
          );
          let exited = false;
          try {
            signal.throwIfAborted();
            const exitStatus = await client.wait(id, signal);
            exited = true;
            signal.throwIfAborted();
            const result = await client.output(id, signal);
            if (Buffer.byteLength(result.output) > terminalOutputBytes)
              throw new AcpError("resource_limit");
            return { ...result, exitStatus };
          } finally {
            try {
              if (!exited || signal.aborted) await client.kill(id, AbortSignal.timeout(2000));
            } finally {
              // Cleanup must never use the already-aborted prompt signal.
              await client.release(id, AbortSignal.timeout(2000));
            }
          }
        },
      ),
    );
  return Object.freeze(tools);
}

function text(value: unknown, nonempty: boolean): asserts value is string {
  if (typeof value !== "string" || (nonempty && !value) || value.includes("\0"))
    throw new AcpError("invalid_content");
  if (Buffer.byteLength(value) > maxBytes) throw new AcpError("resource_limit");
}

/** Lexical and existing-ancestor checks; the editor remains responsible for access-time policy. */
export async function workspacePath(
  cwd: string,
  roots: readonly string[],
  input: string,
): Promise<string> {
  if (!input || /\p{Cc}/u.test(input)) throw new AcpError("policy_denied");
  const path = resolve(cwd, input);
  if (!roots.some((root) => contains(root, path))) throw new AcpError("policy_denied");
  let ancestor = path;
  for (;;) {
    try {
      const canonical = await realpath(ancestor);
      if (!roots.some((root) => contains(root, canonical))) throw new AcpError("policy_denied");
      return path;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new AcpError("policy_denied");
      // realpath also reports ENOENT for dangling symlinks. Do not treat those
      // as missing directories: an editor could create their outside target.
      const existing = await lstat(ancestor).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw new AcpError("policy_denied");
        return undefined;
      });
      if (existing) throw new AcpError("policy_denied");
      const parent = dirname(ancestor);
      if (parent === ancestor) throw new AcpError("policy_denied");
      ancestor = parent;
    }
  }
}

function contains(root: string, path: string): boolean {
  const child = relative(root, path);
  return child === "" || (child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child));
}

export function editorPresentation(
  call: ToolCallPart,
  tools: readonly AnyTool[],
  cwd: string,
): AcpToolPresentation | undefined {
  if (!tools.some((tool) => tool.name === call.toolName)) return undefined;
  if (!call.input || typeof call.input !== "object" || Array.isArray(call.input)) return undefined;
  const input = call.input as JsonObject;
  if (call.toolName === "editor_run_terminal") {
    if (
      typeof input.command !== "string" ||
      (input.args !== undefined &&
        (!Array.isArray(input.args) || input.args.some((arg) => typeof arg !== "string")))
    )
      return { title: "Run editor terminal", kind: "execute" };
    const command = [input.command, ...((input.args as string[] | undefined) ?? [])]
      .map((arg) => {
        const clean = arg.replace(/\p{Cc}/gu, " ");
        return /^[a-zA-Z0-9_./:=+-]+$/.test(clean) ? clean : JSON.stringify(clean);
      })
      .join(" ");
    const path =
      input.cwd === undefined
        ? cwd
        : typeof input.cwd === "string"
          ? resolve(cwd, input.cwd)
          : undefined;
    return {
      title: `Run: ${command}`,
      kind: "execute",
      text: `Command: ${command}${path === undefined ? "" : ` | cwd: ${path}`}`,
      locations: path === undefined ? [] : [{ path }],
    };
  }
  if (typeof input.path !== "string") return undefined;
  const locations = [{ path: input.path }];
  if (call.toolName === "editor_write_text_file" && typeof input.content === "string") {
    return {
      title: "Write editor file",
      kind: "edit",
      locations,
      diffs: [{ path: input.path, newText: input.content }],
    };
  }
  return { title: "Read editor file", kind: "read", locations };
}
