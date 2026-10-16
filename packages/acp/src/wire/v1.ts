import { agent, RequestError, type Stream } from "@agentclientprotocol/sdk";
import type { AcpAgentInfo } from "../types.js";
import packageJson from "../../package.json";

/** Keep SDK state and v1 handlers at this boundary, separate from session execution. */
export function connectV1(stream: Stream, agentInfo?: AcpAgentInfo) {
  let initialized = false;

  return agent({ name: "anvia-acp" })
    .onRequest("initialize", () => {
      if (initialized) {
        throw RequestError.invalidRequest({ kind: "already_initialized" });
      }
      initialized = true;
      return {
        protocolVersion: 1,
        agentInfo: agentInfo ?? { name: "anvia", version: packageJson.version },
        authMethods: [],
        agentCapabilities: {
          loadSession: false,
          promptCapabilities: { image: false, audio: false, embeddedContext: false },
          mcpCapabilities: { http: false, sse: false },
          sessionCapabilities: {},
        },
      };
    })
    .onRequest("authenticate", () => {
      if (!initialized) {
        throw RequestError.invalidRequest({ kind: "not_initialized" });
      }
      return {};
    })
    .connect(stream);
}
