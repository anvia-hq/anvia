import {
  agent,
  RequestError,
  type ContentBlock,
  type ElicitationPropertySchema,
  type Stream,
  type SessionUpdate as V1Update,
} from "@agentclientprotocol/sdk";
import type { AcpClientCapabilities, AcpOptions } from "../types.js";
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
      return {
        protocolVersion: 1,
        agentInfo: options.agentInfo ?? { name: "anvia", version: packageJson.version },
        authMethods: [],
        agentCapabilities: {
          loadSession: false,
          promptCapabilities: {
            image: options.images ?? false,
            audio: false,
            embeddedContext: false,
          },
          mcpCapabilities: { http: sessions.supportsHttpMcp, sse: false },
          sessionCapabilities: {},
        },
      };
    })
    .onRequest("authenticate", () => {
      requireInitialized();
      return {};
    })
    .onRequest("session/new", ({ params }) => {
      requireInitialized();
      return respond(async () => {
        return {
          sessionId: await sessions.create(
            params.cwd,
            capabilities,
            params.mcpServers.map((server) => {
              if ("type" in server && server.type !== undefined) {
                if (server.type === "acp") throw new AcpError("unsupported_mcp");
                return server;
              }
              return { ...server, type: "stdio" as const };
            }),
          ),
        };
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
                const reply: unknown = await client.request(
                  "session/request_permission",
                  {
                    sessionId: params.sessionId,
                    toolCall: {
                      toolCallId: tool.id,
                      title: tool.title,
                      kind: tool.kind,
                      locations: [...tool.locations],
                      status: "pending",
                    },
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
    case "tool":
      return {
        sessionUpdate: "tool_call",
        toolCallId: update.id,
        title: update.title,
        kind: update.kind,
        locations: [...update.locations],
        status: "pending",
      };
    case "tool-update": {
      const result: V1Update = {
        sessionUpdate: "tool_call_update",
        toolCallId: update.id,
        status: update.status,
      };
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
