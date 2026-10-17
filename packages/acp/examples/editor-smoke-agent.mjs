import { Agent } from "@anvia/core/agent";
import { Usage } from "@anvia/core/completion";
import { setTimeout as delay } from "node:timers/promises";

// Deterministic editor exercise, not a coding agent or a provider/auth integration.
// Failures are explicit simulations. Never read or print real credentials.
const failure = process.env.ANVIA_ACP_SMOKE_FAILURE;
if (failure && !["missing-config", "missing-credentials"].includes(failure)) {
  console.error("ACP smoke: unknown ANVIA_ACP_SMOKE_FAILURE; unset it for the offline demo.");
  throw new Error("Invalid smoke configuration");
}
if (failure === "missing-config") {
  console.error("ACP smoke: simulated missing model configuration; unset ANVIA_ACP_SMOKE_FAILURE.");
  throw new Error("Missing smoke configuration");
}

export function sessionFactory(context) {
  if (failure === "missing-credentials") {
    console.error(
      "ACP smoke: simulated missing provider credentials. Configure credentials in your Anvia " +
        "factory, not ACP authenticate. Unset ANVIA_ACP_SMOKE_FAILURE for this offline demo.",
    );
    throw new Error("Missing simulated credentials");
  }
  let executions = 0;
  const counter = {
    name: "smoke_counter",
    requiresApproval: true,
    definition: () => ({
      name: "smoke_counter",
      description: "Increment this session's in-memory smoke counter. No files or commands.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    }),
    call() {
      executions++;
      return `Counter: ${executions}`;
    },
  };
  // Only the dedicated smoke server/tool may be invoked by this deterministic model.
  const mcpTool = context.mcpServers
    .find((server) => server.name === "anvia-smoke")
    ?.tools.find((tool) => tool.name.endsWith("_smoke_ping"));
  return {
    agent: new Agent({
      id: context.sessionId,
      retries: false,
      maxTurns: 2,
      tools: [counter],
      mcpServers: context.mcpServers,
      model: {
        provider: "fixture",
        modelId: "editor-smoke-offline",
        capabilities: { streaming: true, tools: true, toolChoice: true },
        async *streamCompletion(request, options) {
          const history = request.chatHistory;
          const users = history.filter((message) => message.role === "user");
          const userText = (message) =>
            message.content
              .filter((part) => part.type === "text")
              .map((part) => part.text)
              .join("")
              .trim();
          const text = userText(users.at(-1));
          const signal = options.abortSignal;
          if (text === "smoke:wait") {
            yield { type: "text_delta", delta: "Waiting for cancel…" };
            // Finite safety ceiling; cancel should settle well before it.
            await delay(60_000, undefined, { signal });
          }
          const results = history
            .slice(history.findLastIndex((message) => message.role === "user"))
            .flatMap((message) => message.content)
            .filter((part) => part.type === "tool-result");
          const requestedTool =
            text === "smoke:tool" ? counter : text === "smoke:mcp" ? mcpTool : null;
          if (requestedTool && results.length === 0) {
            yield {
              type: "final",
              response: {
                choice: [
                  {
                    type: "tool-call",
                    toolCallId: "smoke-call",
                    toolName: requestedTool.name,
                    input: {},
                  },
                ],
                usage: Usage.empty(),
                rawResponse: {},
              },
            };
            return;
          }
          const lines = [
            `Turn: ${users.length}. Counter: ${executions}.\n`,
            `Previous: ${users.length > 1 ? userText(users.at(-2)) : "(none)"}.\n`,
            text === "smoke:mcp" && !mcpTool
              ? "MCP smoke tool unavailable. Forward the anvia-smoke stdio server.\n"
              : results.length
                ? `Tool result: ${JSON.stringify(results[0].output)}\n`
                : "Offline streaming ready. Try smoke:tool, smoke:mcp, or smoke:wait.\n",
          ];
          for (const line of lines) {
            yield { type: "text_delta", delta: line };
            await delay(120, undefined, { signal });
          }
          yield {
            type: "final",
            response: {
              choice: [{ type: "text", text: lines.join("") }],
              usage: Usage.empty(),
              rawResponse: {},
            },
          };
        },
      },
    }),
    toolPresentation: (call) => ({
      title: call.toolName === counter.name ? "Increment smoke counter" : "Ping smoke MCP server",
      kind: "other",
    }),
  };
}
