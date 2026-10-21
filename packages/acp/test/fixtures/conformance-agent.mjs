import { Agent } from "@anvia/core/agent";
import { Usage } from "@anvia/core/completion";

// Exercise launcher log redirection during import, generation, execution and disposal.
console.log("fixture imported");
process.stdout.write("fixture direct write\n");

export function sessionFactory(context) {
  let executions = 0;
  const tool = {
    name: "fixture_action",
    requiresApproval: true,
    definition: () => ({
      name: "fixture_action",
      description: "Increment an in-memory fixture counter.",
      parameters: { type: "object", properties: {} },
    }),
    call() {
      executions++;
      console.log("fixture tool executed");
      return "fixture action complete";
    },
  };
  return {
    agent: new Agent({
      id: context.sessionId,
      retries: false,
      tools: [tool, ...context.editorTools],
      mcpServers: context.mcpServers,
      model: {
        provider: "fixture",
        modelId: "conformance-offline",
        capabilities: { streaming: true, tools: true, toolChoice: true },
        async *streamCompletion(request, options) {
          console.info("fixture generation");
          const history = request.chatHistory;
          const users = history.filter((message) => message.role === "user");
          const text = users
            .at(-1)
            .content.filter((part) => part.type === "text")
            .map((part) => part.text)
            .join("");
          if (text === "fixture:wait") {
            yield { type: "text_delta", delta: "waiting" };
            await new Promise((resolve) => {
              if (options.abortSignal.aborted) resolve();
              else options.abortSignal.addEventListener("abort", resolve, { once: true });
            });
            options.abortSignal.throwIfAborted();
          }
          const turn = history.slice(history.findLastIndex((message) => message.role === "user"));
          const results = turn
            .flatMap((message) => message.content)
            .filter((part) => part.type === "tool-result");
          let toolName;
          let input = {};
          if (text === "fixture:tools" && results.length < 2) toolName = tool.name;
          if (text === "fixture:mcp" && results.length === 0)
            toolName = context.mcpServers[0]?.tools[0]?.name;
          if (text === "fixture:read" && results.length === 0) {
            toolName = "editor_read_text_file";
            input = { path: "buffer.txt" };
          }
          if (text === "fixture:terminal" && results.length === 0) {
            toolName = "editor_run_terminal";
            input = { command: "fixture-command" };
          }
          const choice = toolName
            ? [
                {
                  type: "tool-call",
                  toolCallId: "reused",
                  callId: "provider-reused",
                  toolName,
                  input,
                },
              ]
            : [
                {
                  type: "text",
                  text: JSON.stringify({
                    cwd: context.cwd,
                    users: users.map((message) => message.content),
                    executions,
                  }),
                },
              ];
          if (!toolName) {
            // Distinct chunks let the subprocess client assert ordering and no replay.
            const text = choice[0].text;
            const middle = Math.floor(text.length / 2);
            yield { type: "text_delta", delta: text.slice(0, middle) };
            yield { type: "text_delta", delta: text.slice(middle) };
          }
          yield { type: "final", response: { choice, usage: Usage.empty(), rawResponse: {} } };
        },
      },
    }),
    dispose() {
      console.debug("fixture disposed");
    },
  };
}
