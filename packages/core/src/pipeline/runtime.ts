import { abortError, throwIfAborted } from "../internal/abort";
import { scopedNode } from "./graph";
import type {
  PipelineGraphNode,
  PipelineNodePath,
  PipelineRunContext,
  PipelineRunEvent,
  PipelineStageContext,
  PipelineTraceInfo,
} from "./types";

export async function runNode<Output>(
  context: PipelineRunContext,
  node: PipelineGraphNode,
  path: PipelineNodePath,
  input: unknown,
  fn: (trace: PipelineTraceInfo | undefined) => Output | Promise<Output>,
): Promise<Awaited<Output>> {
  throwIfAborted(context.abortSignal);
  const eventNode = scopedNode(node, path);
  const startedAt = Date.now();
  const eventBase = {
    runId: context.runId,
    pipelineId: context.pipelineId,
    path: [...path],
    node: eventNode,
  };
  const observers = await context.observability.startStage({ ...eventBase, input });
  try {
    await emitEvent(context, { type: "stage_started", ...eventBase });
  } catch (error) {
    await observers.error({ ...eventBase, error, durationMs: Date.now() - startedAt });
    throw error;
  }

  try {
    const output = (await fn(observers.trace)) as Awaited<Output>;
    throwIfAborted(context.abortSignal);
    const durationMs = Date.now() - startedAt;
    await emitEvent(context, {
      type: "stage_completed",
      ...eventBase,
      durationMs,
    });
    await observers.end({ ...eventBase, output, durationMs });
    return output;
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const failureEvent: PipelineRunEvent = {
      type: "stage_failed",
      ...eventBase,
      durationMs,
      error,
    };
    try {
      await emitEvent(context, failureEvent);
    } catch (observerError) {
      await observers.error({ ...eventBase, error, durationMs });
      throw new AggregateError(
        [error, observerError],
        `Pipeline stage "${node.id}" and its observer both failed.`,
      );
    }
    await observers.error({ ...eventBase, error, durationMs });
    throw error;
  }
}

export function stageContext<Input>(
  input: Input,
  context: PipelineRunContext,
): PipelineStageContext<Input> {
  return {
    input,
    runId: context.runId,
    pipelineId: context.pipelineId,
    runMetadata: context.runMetadata,
    abortSignal: context.abortSignal,
  };
}

export function childContext(
  context: PipelineRunContext,
  abortSignal: AbortSignal | undefined,
): PipelineRunContext {
  return { ...context, abortSignal };
}

export function combineAbortSignals(
  parent: AbortSignal | undefined,
  local: AbortSignal,
): { signal: AbortSignal; dispose(): void } {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(parent?.reason);
  const abortFromLocal = () => controller.abort(local.reason);

  if (parent?.aborted === true) {
    controller.abort(parent.reason);
  } else if (local.aborted) {
    controller.abort(local.reason);
  } else {
    parent?.addEventListener("abort", abortFromParent, { once: true });
    local.addEventListener("abort", abortFromLocal, { once: true });
  }

  return {
    signal: controller.signal,
    dispose() {
      parent?.removeEventListener("abort", abortFromParent);
      local.removeEventListener("abort", abortFromLocal);
    },
  };
}

export function pipelineAbortError(signal: AbortSignal | undefined): Error {
  return abortError(signal?.reason);
}

async function emitEvent(context: PipelineRunContext, event: PipelineRunEvent): Promise<void> {
  if (context.observer === undefined) return;
  try {
    await context.observer.onEvent(event);
  } catch (error) {
    if (context.failOnObserverError) throw error;
  }
}
