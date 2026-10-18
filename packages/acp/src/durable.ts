import type { Agent } from "@anvia/core/agent";
import type { DurableAgentRegistration, DurableRuntime } from "@anvia/durable";
import { AcpError } from "./errors.js";
import type { AcpDurableDriver } from "./driver.js";
import type { AcpSessionBinding } from "./types.js";

/**
 * Register once per host runtime, then return this binding from the session factory.
 * The host owns runtime.resume()/close() and tool resources across connections.
 * Registration validation is delegated to DurableRuntime; no limits are bypassed.
 */
export function createDurableSessionBinding(
  runtime: DurableRuntime,
  registration: Omit<DurableAgentRegistration, "agent"> & { agent: Agent },
): AcpSessionBinding {
  runtime.registerAgents([registration]);
  const agentId = registration.agent.id;
  const driver: AcpDurableDriver = {
    key: JSON.stringify([agentId, registration.version]),
    async execute({ sessionId, pending, historyLength, signal, project, interact }) {
      signal.throwIfAborted();
      const run = await runtime.submit({
        agentId,
        sessionId,
        requestId: pending.requestId,
        prompt: pending.prompt,
      });
      let projected = historyLength;
      while (true) {
        signal.throwIfAborted();
        const snapshot = await run.snapshot({ operations: false });
        const saved = snapshot.run;
        if (saved.status === "cancelled") return "cancelled";
        if (saved.status === "needs_attention") throw new AcpError("recovery_required");
        if (saved.status === "failed") {
          if (saved.exhaustion?.reason === "max_turns") return "max_turn_requests";
          throw new AcpError("execution_failed");
        }
        if (saved.outcome && (saved.status === "waiting" || saved.status === "completed")) {
          const messages = [...saved.history, ...saved.outcome.messages];
          await project({ ...saved.outcome, messages: messages.slice(projected) });
          projected = messages.length;
          signal.throwIfAborted();
          if (saved.status === "completed") return { outcome: saved.outcome, messages };
          if (saved.outcome.type !== "interaction") throw new AcpError("execution_failed");
          const response = await interact(saved.outcome);
          // A disconnected client must never deliver a late approval to the journal.
          signal.throwIfAborted();
          if (response === "cancel") {
            await run.cancel();
            return "cancelled";
          }
          await run.respond(saved.outcome.interaction.id, response);
          continue;
        }
        // Subscribe after the atomic snapshot cursor, avoiding a snapshot/subscribe gap.
        // Only project committed outcomes. Raw events, partial attempts and errors stay private.
        for await (const event of run.stream({ after: snapshot.cursor, abortSignal: signal })) {
          if (event.type === "status") break;
        }
      }
    },
    async cancel(sessionId, requestId) {
      let after: number | undefined;
      do {
        const page = await runtime.listRuns({ sessionId, agentId, after, limit: 100 });
        const match = page.runs.find((run) => run.requestId === requestId);
        if (match) {
          const run = await runtime.getRun(match.id);
          await run.cancel();
          return (await run.status()).status === "completed" ? "completed" : "cancelled";
        }
        after = page.nextCursor;
      } while (after !== undefined);
      // A write-ahead record can exist before submit. Cancellation must not start it.
      return "cancelled";
    },
  };
  return { agent: registration.agent, driver };
}
