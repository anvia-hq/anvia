import { abortError, throwIfAborted } from "../internal/abort";
import { scopedNode } from "./graph";
import type {
  PipelineGraphNode,
  PipelineNodePath,
  PipelineRunContext,
  PipelineRunEvent,
  PipelineStageContext,
} from "./types";

export async function runNode<Output>(
  context: PipelineRunContext,
  node: PipelineGraphNode,
  path: PipelineNodePath,
  fn: () => Output | Promise<Output>,
): Promise<Awaited<Output>> {
  throwIfAborted(context.abortSignal);
  const eventNode = scopedNode(node, path);
  const startedAt = Date.now();
  await emitEvent(context, {
    type: "stage_started",
    runId: context.runId,
    pipelineId: context.pipelineId,
    path: [...path],
    node: eventNode,
  });

  try {
    const output = (await fn()) as Awaited<Output>;
    throwIfAborted(context.abortSignal);
    await emitEvent(context, {
      type: "stage_completed",
      runId: context.runId,
      pipelineId: context.pipelineId,
      path: [...path],
      node: eventNode,
      durationMs: Date.now() - startedAt,
    });
    return output;
  } catch (error) {
    const failureEvent: PipelineRunEvent = {
      type: "stage_failed",
      runId: context.runId,
      pipelineId: context.pipelineId,
      path: [...path],
      node: eventNode,
      durationMs: Date.now() - startedAt,
      error,
    };
    try {
      await emitEvent(context, failureEvent);
    } catch (observerError) {
      throw new AggregateError(
        [error, observerError],
        `Pipeline stage "${node.id}" and its observer both failed.`,
      );
    }
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
