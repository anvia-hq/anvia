import {
  type AgentContinuation,
  type AgentInteractionResponse,
  assertAgentInteractionResponse,
} from "@anvia/core/agent/interactions";

export type StudioContinuationRegistration<Context> = Readonly<{
  continuation: AgentContinuation;
  context: Context;
}>;

export type StudioContinuationRegistry<Context> = {
  register(registration: StudioContinuationRegistration<Context>): void;
  take(
    interactionId: string,
    agentId: string,
    response: AgentInteractionResponse,
  ):
    | Readonly<{ status: "missing" }>
    | Readonly<{ status: "claimed" }>
    | Readonly<{ status: "invalid"; error: TypeError }>
    | Readonly<{
        status: "ready";
        registration: StudioContinuationRegistration<Context>;
      }>;
  clear(): void;
};

export function createStudioContinuationRegistry<Context>(): StudioContinuationRegistry<Context> {
  const pending = new Map<string, StudioContinuationRegistration<Context>>();
  const claimed = new Set<string>();
  return {
    register(registration) {
      const id = registration.continuation.interaction.id;
      if (pending.has(id) || claimed.has(id)) {
        throw new TypeError(`Duplicate Studio interaction ID "${id}".`);
      }
      pending.set(id, registration);
    },
    take(interactionId, agentId, response) {
      if (claimed.has(interactionId)) return { status: "claimed" };
      const registration = pending.get(interactionId);
      if (registration === undefined || registration.continuation.agentId !== agentId) {
        return { status: "missing" };
      }
      const request = registration.continuation.interaction;
      try {
        assertAgentInteractionResponse(request, response);
      } catch (error) {
        return {
          status: "invalid",
          error: error instanceof TypeError ? error : new TypeError(String(error)),
        };
      }
      pending.delete(interactionId);
      claimed.add(interactionId);
      return { status: "ready", registration };
    },
    clear() {
      pending.clear();
      claimed.clear();
    },
  };
}
