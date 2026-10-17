import type { AgentContext } from "@agentclientprotocol/sdk";
import type { EditorClient } from "../editor-tools.js";

export function editorClient(client: AgentContext): (sessionId: string) => EditorClient {
  return (sessionId) => ({
    read: async (path, signal) =>
      (
        await client.request(
          "fs/read_text_file",
          { sessionId, path },
          { cancellationSignal: signal },
        )
      ).content,
    write: async (path, content, signal) => {
      await client.request(
        "fs/write_text_file",
        { sessionId, path, content },
        { cancellationSignal: signal },
      );
    },
    create: async (command, args, cwd) =>
      (
        await client.request("terminal/create", {
          sessionId,
          command,
          args,
          cwd,
          outputByteLimit: 1024 * 1024,
        })
      ).terminalId,
    wait: async (terminalId, signal) => {
      const result = await client.request(
        "terminal/wait_for_exit",
        { sessionId, terminalId },
        { cancellationSignal: signal },
      );
      return { exitCode: result.exitCode ?? null, signal: result.signal ?? null };
    },
    output: async (terminalId, signal) => {
      const result = await client.request(
        "terminal/output",
        { sessionId, terminalId },
        { cancellationSignal: signal },
      );
      return { output: result.output, truncated: result.truncated };
    },
    kill: async (terminalId, signal) => {
      await client.request(
        "terminal/kill",
        { sessionId, terminalId },
        { cancellationSignal: signal },
      );
    },
    release: async (terminalId, signal) => {
      await client.request(
        "terminal/release",
        { sessionId, terminalId },
        { cancellationSignal: signal },
      );
    },
  });
}
