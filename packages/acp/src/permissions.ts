import {
  assertAgentInteractionResponse,
  type AgentInteractionResponse,
  type AgentQuestionPrompt,
} from "@anvia/core/agent/interactions";
import type { AgentInteractionOutcome } from "@anvia/core/agent";
import { AcpError } from "./errors.js";
import type { AcpToolPresentation } from "./types.js";
import type { PendingRequests } from "./pending-requests.js";
import type { TurnEvents } from "./events.js";

export type PermissionTool = { id: string } & Required<AcpToolPresentation>;
export type InteractionClient = {
  permission(tool: PermissionTool, signal: AbortSignal): Promise<"allow" | "reject" | "cancel">;
  question(
    toolId: string,
    questions: readonly AgentQuestionPrompt[],
    signal: AbortSignal,
  ): Promise<AgentInteractionResponse | "cancel">;
};

/** The registry is captured for this prompt, never looked up after a reply arrives. */
export async function requestInteraction(
  outcome: AgentInteractionOutcome,
  events: TurnEvents,
  requests: PendingRequests,
  client: InteractionClient | undefined,
  elicitationForm: boolean,
): Promise<AgentInteractionResponse | "cancel"> {
  if (!client) throw new AcpError("unsupported_interaction");
  const request = outcome.interaction;
  const tool = await events.interaction(request);
  if (request.type === "tool-approval") {
    const decision = await requests.run((signal) => client.permission(tool, signal));
    return decision === "cancel"
      ? "cancel"
      : { type: "tool-approval", approved: decision === "allow" };
  }
  if (!elicitationForm) throw new AcpError("unsupported_interaction");
  const response = await requests.run((signal) =>
    client.question(tool.id, request.questions, signal),
  );
  if (response === "cancel") return response;
  try {
    assertAgentInteractionResponse(request, response);
  } catch {
    throw new AcpError("invalid_interaction_response");
  }
  return response;
}
