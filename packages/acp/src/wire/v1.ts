import {
  agent,
  RequestError,
  type ContentBlock,
  type AgentContext,
  type SessionCapabilities,
  type McpServer,
  type AvailableCommand,
  type ToolCallUpdate,
  type ToolCallContent,
  type ElicitationPropertySchema,
  type Stream,
  type SessionUpdate as V1Update,
} from "@agentclientprotocol/sdk";
import { editorClient } from "./editor.js";
import type { AcpTranscriptEntry } from "../transcript.js";
import type { AcpClientCapabilities, AcpOptions, AcpToolPresentation } from "../types.js";
import type { PromptBlock } from "../content.js";
import { AcpError, errorCodes } from "../errors.js";
import type { SessionManager } from "../session-manager.js";
import type { SessionUpdate } from "../events.js";
import packageJson from "../../package.json";

/** Keep SDK state and v1 handlers at this boundary, separate from session execution. */
export function connectV1(stream: Stream, sessions: SessionManager, options: AcpOptions) {
  let initialized = false;
  let capabilities: AcpClientCapabilities = {
    readTextFile: false,
    writeTextFile: false,
    terminal: false,
    elicitationForm: false,
  };

  function requireInitialized() {
    if (!initialized) throw RequestError.invalidRequest({ kind: "not_initialized" });
  }

  async function announceCommands(client: AgentContext, sessionId: string) {
    if (sessions.configuration.commands.length)
      await client.notify("session/update", {
        sessionId,
        update: {
          sessionUpdate: "available_commands_update",
          availableCommands: sessions.configuration.commands.map((command) => {
            const result: AvailableCommand = {
              name: command.name,
              description: command.description,
            };
            if (command.inputHint) result.input = { hint: command.inputHint };
            return result;
          }),
        },
      });
  }

  return agent({ name: "anvia-acp" })
    .onRequest("initialize", ({ params }) => {
      if (initialized) {
        throw RequestError.invalidRequest({ kind: "already_initialized" });
      }
      initialized = true;
      const client = params.clientCapabilities;
      capabilities = Object.freeze({
        readTextFile: client?.fs?.readTextFile === true,
        writeTextFile: client?.fs?.writeTextFile === true,
        terminal: client?.terminal === true,
        elicitationForm: client?.elicitation?.form != null,
      });
      const sessionCapabilities: SessionCapabilities = { resume: {}, close: {} };
      if (sessions.store.list) sessionCapabilities.list = {};
      if (sessions.store.delete) sessionCapabilities.delete = {};
      return {
        protocolVersion: 1,
        agentInfo: options.agentInfo ?? { name: "anvia", version: packageJson.version },
        authMethods: [],
        agentCapabilities: {
          loadSession: true,
          promptCapabilities: {
            image: options.images ?? false,
            audio: false,
            embeddedContext: options.embeddedContext ?? false,
          },
          mcpCapabilities: { http: sessions.supportsHttpMcp, sse: false },
          sessionCapabilities,
        },
      };
    })
    .onRequest("authenticate", () => {
      requireInitialized();
      return {};
    })
    .onRequest("session/new", ({ params, client }) => {
      requireInitialized();
      return respond(async () => {
        const sessionId = await sessions.create(
          params.cwd,
          capabilities,
          normalizeServers(params.mcpServers),
          editorClient(client),
        );
        await announceCommands(client, sessionId);
        return { sessionId, configOptions: sessions.get(sessionId).configOptions };
      });
    })
    .onRequest("session/load", ({ params, client }) => {
      requireInitialized();
      return respond(async () => {
        const session = await sessions.restore(
          params.sessionId,
          params.cwd,
          capabilities,
          normalizeServers(params.mcpServers),
          editorClient(client),
          (entry) =>
            client.notify("session/update", {
              sessionId: params.sessionId,
              update: toV1Replay(entry),
            }),
        );
        await announceCommands(client, params.sessionId);
        return { configOptions: session.configOptions };
      });
    })
    .onRequest("session/resume", ({ params, client }) => {
      requireInitialized();
      return respond(async () => {
        const session = await sessions.restore(
          params.sessionId,
          params.cwd,
          capabilities,
          normalizeServers(params.mcpServers ?? []),
          editorClient(client),
        );
        await announceCommands(client, params.sessionId);
        return { configOptions: session.configOptions };
      });
    })
    .onRequest("session/list", ({ params }) => {
      requireInitialized();
      return respond(async () => {
        const page = await sessions.list(params.cwd ?? undefined, params.cursor ?? undefined);
        return { ...page, sessions: [...page.sessions] };
      });
    })
    .onRequest("session/close", ({ params }) => {
      requireInitialized();
      return respond(async () => {
        await sessions.closeSession(params.sessionId);
        return {};
      });
    })
    .onRequest("session/delete", ({ params }) => {
      requireInitialized();
      return respond(async () => {
        await sessions.deleteSession(params.sessionId);
        return {};
      });
    })
    .onRequest("session/set_config_option", ({ params, client }) => {
      requireInitialized();
      return respond(async () => {
        const session = sessions.get(params.sessionId);
        await session.setConfig(params.configId, params.value);
        const configOptions = session.configOptions;
        await client.notify("session/update", {
          sessionId: params.sessionId,
          update: { sessionUpdate: "config_option_update", configOptions },
        });
        return { configOptions };
      });
    })
    .onRequest("session/prompt", ({ params, client }) => {
      requireInitialized();
      return respond(async () => ({
        stopReason: await sessions.get(params.sessionId).prompt(
          params.prompt.map(normalizeContent),
          (update) =>
            client.notify("session/update", {
              sessionId: params.sessionId,
              update: toV1Update(update),
            }),
          {
            async permission(tool, signal) {
              try {
                const toolCall: ToolCallUpdate = {
                  toolCallId: tool.id,
                  title: tool.title,
                  kind: tool.kind,
                  locations: [...tool.locations],
                  status: "pending",
                };
                if (tool.diffs || tool.text !== undefined) toolCall.content = toolContent(tool);
                const reply: unknown = await client.request(
                  "session/request_permission",
                  {
                    sessionId: params.sessionId,
                    toolCall,
                    options: [
                      { optionId: "allow_once", name: "Allow once", kind: "allow_once" },
                      { optionId: "reject_once", name: "Reject once", kind: "reject_once" },
                    ],
                  },
                  { cancellationSignal: signal },
                );
                const outcome = object(object(reply)?.outcome);
                if (outcome?.outcome === "cancelled") return "cancel";
                return outcome?.outcome === "selected" && outcome.optionId === "allow_once"
                  ? "allow"
                  : "reject";
              } catch {
                signal.throwIfAborted();
                // RPC errors and SDK schema failures cannot authorize execution.
                return "reject";
              }
            },
            async question(toolId, questions, signal) {
              const properties: Record<string, ElicitationPropertySchema> = {};
              // Adapter field IDs avoid prototype keys and keep core IDs private.
              for (const [index, question] of questions.entries()) {
                const property: ElicitationPropertySchema = {
                  type: "string",
                  title: question.text,
                  minLength: 1,
                };
                if (question.choices && question.allowCustom !== true) {
                  property.oneOf = question.choices.map((choice) => ({
                    const: choice.value,
                    title: choice.label,
                  }));
                }
                properties[`q${index}`] = property;
              }
              let reply: unknown;
              try {
                reply = await client.request(
                  "elicitation/create",
                  {
                    sessionId: params.sessionId,
                    toolCallId: toolId,
                    mode: "form",
                    message: "Please answer the tool's questions.",
                    requestedSchema: {
                      type: "object",
                      properties,
                      required: Object.keys(properties),
                    },
                  },
                  { cancellationSignal: signal },
                );
              } catch {
                signal.throwIfAborted();
                throw new AcpError("invalid_interaction_response");
              }
              const result = object(reply);
              if (result?.action === "cancel" || result?.action === "decline") return "cancel";
              const content = object(result?.content);
              if (
                result?.action !== "accept" ||
                !content ||
                Object.keys(content).length !== questions.length
              ) {
                throw new AcpError("invalid_interaction_response");
              }
              return {
                type: "tool-question",
                answers: questions.map((question, index) => {
                  const value = content[`q${index}`];
                  if (typeof value !== "string") throw new AcpError("invalid_interaction_response");
                  return { questionId: question.id, value };
                }),
              };
            },
          },
        ),
      }));
    })
    .onNotification("session/cancel", ({ params }) => {
      // Session cancellation is independent of the SDK's $/cancel_request signal.
      if (initialized) sessions.cancel(params.sessionId);
    })
    .connect(stream);
}

async function respond<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const kind = error instanceof AcpError ? error.kind : "execution_failed";
    throw new RequestError(errorCodes[kind], kind, { kind });
  }
}

function normalizeContent(block: ContentBlock): PromptBlock {
  switch (block.type) {
    case "text":
      return { type: "text", text: block.text };
    case "image":
      return { type: "image", data: block.data, mimeType: block.mimeType };
    case "resource": {
      if (!("text" in block.resource)) return { type: "unsupported" };
      const resource: PromptBlock = {
        type: "resource",
        uri: block.resource.uri,
        text: block.resource.text,
      };
      if (block.resource.mimeType != null) resource.mimeType = block.resource.mimeType;
      return resource;
    }
    case "resource_link": {
      const reference: PromptBlock = {
        type: "resource_link",
        uri: block.uri,
        name: block.name,
      };
      if (block.description != null) reference.description = block.description;
      return reference;
    }
    default:
      return { type: "unsupported" };
  }
}

function toV1Update(update: SessionUpdate): V1Update {
  switch (update.type) {
    case "text":
    case "thought":
      return {
        sessionUpdate: update.type === "text" ? "agent_message_chunk" : "agent_thought_chunk",
        content: { type: "text", text: update.text },
      };
    case "tool": {
      const result: V1Update = {
        sessionUpdate: "tool_call",
        toolCallId: update.id,
        title: update.title,
        kind: update.kind,
        locations: [...update.locations],
        status: "pending",
      };
      if (update.diffs || update.text !== undefined) result.content = toolContent(update);
      return result;
    }
    case "tool-update": {
      const result: V1Update = {
        sessionUpdate: "tool_call_update",
        toolCallId: update.id,
        status: update.status,
      };
      if (update.diffs !== undefined || update.text !== undefined)
        result.content = toolContent(update);
      if (update.title !== undefined) result.title = update.title;
      if (update.kind !== undefined) result.kind = update.kind;
      if (update.locations !== undefined) result.locations = [...update.locations];
      return result;
    }
  }
}

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function toolContent(tool: AcpToolPresentation): ToolCallContent[] {
  const content: ToolCallContent[] = (tool.diffs ?? []).map((diff) => ({ type: "diff", ...diff }));
  if (tool.text !== undefined)
    content.push({ type: "content", content: { type: "text", text: tool.text } });
  return content;
}

function normalizeServers(servers: McpServer[]) {
  return servers.map((server) => {
    if ("type" in server && server.type !== undefined) {
      if (server.type === "acp") throw new AcpError("unsupported_mcp");
      return server;
    }
    return { ...server, type: "stdio" as const };
  });
}

function toV1Replay(entry: AcpTranscriptEntry): V1Update {
  if (entry.type !== "user") return toV1Update(entry);
  const block = entry.content;
  let content: ContentBlock;
  if (block.type === "resource") {
    const resource: { uri: string; text: string; mimeType?: string } = {
      uri: block.uri,
      text: block.text,
    };
    if (block.mimeType !== undefined) resource.mimeType = block.mimeType;
    content = { type: "resource", resource };
  } else content = block;
  return { sessionUpdate: "user_message_chunk", content };
}
