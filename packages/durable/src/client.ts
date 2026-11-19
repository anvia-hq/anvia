import type { AgentSteerInput, AgentSteerReceipt } from "@anvia/core/agent";
import type { AgentInteractionResponse } from "@anvia/core/agent/interactions";
import type { ToolResultOutput } from "@anvia/core/completion";
import type { DurableRun } from "./run.js";
import type {
  DurableEvent,
  DurableRunRecord,
  DurableRunSummary,
  DurableSnapshot,
  DurableSteerOptions,
  DurableSubmission,
  DurableSubmitOptions,
  MemoryWriteResolution,
} from "./types.js";

/** Read-only run access. A `DurableObserver` provides it without owning the database. */
export interface DurableRunReader {
  snapshot(id: string, options?: { operations?: boolean }): Promise<DurableSnapshot>;
  status(id: string): Promise<DurableRunSummary>;
  run(id: string): Promise<DurableRunRecord>;
  events(id: string, after: number): Promise<DurableEvent[]>;
}

/**
 * What a `DurableRun` needs from its owner: store reads and run-scoped mutations. It is the seam
 * for a future client that needs no executor (ADR 0001). `DurableRuntime` implements it today.
 */
export interface DurableRunClient extends DurableRunReader {
  steer(
    id: string,
    input: AgentSteerInput,
    options?: DurableSteerOptions,
  ): Promise<AgentSteerReceipt>;
  respond(id: string, interactionId: string, value: AgentInteractionResponse): Promise<void>;
  resolveTool(id: string, operationId: string, output: ToolResultOutput): Promise<void>;
  resolveMemoryWrite(
    id: string,
    operationKey: string,
    resolution: MemoryWriteResolution,
  ): Promise<void>;
  retry(id: string): Promise<void>;
  cancel(id: string): Promise<void>;
}

/** A run client that can also admit new submissions. */
export interface DurableSubmitClient extends DurableRunClient {
  submit(input: DurableSubmission, options?: DurableSubmitOptions): Promise<DurableRun>;
}
