import { agent, RequestError, type ContentBlock, type Stream } from "@agentclientprotocol/sdk";
import type { AcpClientCapabilities, AcpOptions } from "../types.js";
import type { PromptBlock } from "../content.js";
import { AcpError, errorCodes } from "../errors.js";
import type { SessionManager } from "../session-manager.js";
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
          mcpCapabilities: { http: false, sse: false },
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
        // ACP 07 owns validation, launch and rollback of editor-supplied MCP servers.
        if (params.mcpServers.length) throw new AcpError("unsupported_mcp");
        return { sessionId: await sessions.create(params.cwd, capabilities) };
      });
    })
    .onRequest("session/prompt", ({ params }) => {
      requireInitialized();
      return respond(async () => ({
        stopReason: await sessions
          .get(params.sessionId)
          .prompt(params.prompt.map(normalizeContent)),
      }));
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
