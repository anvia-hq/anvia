import { observerSnapshot } from "../observability/snapshot";
import { PipelineObserverDispatchError, type PipelineObserverFailure } from "./errors";
import type {
  PipelineObservabilityOptions,
  PipelineObserverErrorPolicy,
  PipelineObserverMap,
  PipelineRunEndArgs,
  PipelineRunErrorArgs,
  PipelineRunObservation,
  PipelineRunStartArgs,
  PipelineStageEndArgs,
  PipelineStageErrorArgs,
  PipelineStageObservation,
  PipelineStageStartArgs,
  PipelineTraceInfo,
} from "./types";

type NamedObserver<T> = {
  readonly name: string;
  readonly observer: T;
};

type ActiveNamedObserver<T> = NamedObserver<T> & {
  terminal: boolean;
};

export function snapshotPipelineObservability(
  observability: PipelineObservabilityOptions | undefined,
): PipelineObservabilityOptions | undefined {
  if (observability === undefined) return undefined;
  const observers: Record<string, PipelineObserverMap[string]> = {};
  for (const [name, observer] of Object.entries(observability.observers)) {
    if (name.trim().length === 0) {
      throw new TypeError("Pipeline observer names must not be empty.");
    }
    if (
      typeof observer !== "object" ||
      observer === null ||
      typeof observer.startRun !== "function"
    ) {
      throw new TypeError(`Pipeline observer "${name}" must implement startRun().`);
    }
    observers[name] = observer;
  }
  if (observability.primaryTrace !== undefined && !(observability.primaryTrace in observers)) {
    throw new TypeError(
      `Pipeline primaryTrace "${observability.primaryTrace}" must name a configured observer.`,
    );
  }
  const errorPolicy = observability.errorPolicy ?? "ignore";
  if (errorPolicy !== "ignore" && errorPolicy !== "throw") {
    throw new TypeError('Pipeline observability.errorPolicy must be "ignore" or "throw".');
  }
  const snapshot: PipelineObservabilityOptions = {
    observers: Object.freeze(observers),
    errorPolicy,
    ...(observability.primaryTrace === undefined
      ? {}
      : { primaryTrace: observability.primaryTrace }),
  };
  return Object.freeze(snapshot);
}

export async function startPipelineRunObservers(
  observers: PipelineObserverMap,
  args: PipelineRunStartArgs,
  options: {
    readonly primaryTrace?: string | undefined;
    readonly errorPolicy: PipelineObserverErrorPolicy;
  },
): Promise<ActivePipelineRunObservers> {
  const runObservers: ActiveNamedObserver<PipelineRunObservation>[] = [];
  const failures: PipelineObserverFailure[] = [];
  for (const [name, observer] of Object.entries(observers)) {
    try {
      const runObserver = await observer.startRun(observerSnapshot(args));
      if (runObserver !== undefined) {
        runObservers.push({ name, observer: runObserver, terminal: false });
      }
    } catch (error) {
      failures.push({ observer: name, error });
    }
  }
  if (options.errorPolicy === "throw" && failures.length > 0) {
    const startupError = new PipelineObserverDispatchError("startRun", failures);
    const cleanupFailures = await terminateObservers(runObservers, (observer) =>
      observer.error?.(
        observerSnapshot({
          runId: args.runId,
          pipelineId: args.pipelineId,
          status: "failed",
          error: startupError,
          durationMs: 0,
        }),
      ),
    );
    throw new PipelineObserverDispatchError("startRun", [...failures, ...cleanupFailures]);
  }
  return new ActivePipelineRunObservers(runObservers, options);
}

export class ActivePipelineRunObservers {
  readonly trace: PipelineTraceInfo | undefined;

  constructor(
    private readonly observers: readonly ActiveNamedObserver<PipelineRunObservation>[],
    private readonly options: {
      readonly primaryTrace?: string | undefined;
      readonly errorPolicy: PipelineObserverErrorPolicy;
    },
  ) {
    const primary =
      options.primaryTrace === undefined
        ? undefined
        : observers.find((entry) => entry.name === options.primaryTrace);
    this.trace =
      primary?.observer.trace === undefined
        ? undefined
        : Object.freeze({ observer: primary.name, ...primary.observer.trace });
  }

  async startStage(args: PipelineStageStartArgs): Promise<ActivePipelineStageObservers> {
    const stageObservers: ActiveNamedObserver<PipelineStageObservation>[] = [];
    const failures: PipelineObserverFailure[] = [];
    for (const entry of this.observers) {
      if (entry.observer.startStage === undefined) continue;
      try {
        const observer = await entry.observer.startStage(observerSnapshot(args));
        if (observer !== undefined) {
          stageObservers.push({ name: entry.name, observer, terminal: false });
        }
      } catch (error) {
        failures.push({ observer: entry.name, error });
      }
    }
    if (this.options.errorPolicy === "throw" && failures.length > 0) {
      const startupError = new PipelineObserverDispatchError("startStage", failures);
      const cleanupFailures = await terminateObservers(stageObservers, (observer) =>
        observer.error?.(observerSnapshot({ ...args, error: startupError, durationMs: 0 })),
      );
      throw new PipelineObserverDispatchError("startStage", [...failures, ...cleanupFailures]);
    }
    return new ActivePipelineStageObservers(stageObservers, this.options);
  }

  async end(args: PipelineRunEndArgs): Promise<void> {
    await dispatchTerminalObservers(
      this.observers,
      "end",
      (observer) => observer.end(observerSnapshot(args)),
      this.options.errorPolicy,
    );
  }

  async error(args: PipelineRunErrorArgs): Promise<void> {
    await dispatchTerminalObservers(
      this.observers,
      "error",
      (observer) => observer.error?.(observerSnapshot(args)),
      "ignore",
    );
  }
}

export class ActivePipelineStageObservers {
  readonly trace: PipelineTraceInfo | undefined;

  constructor(
    private readonly observers: readonly ActiveNamedObserver<PipelineStageObservation>[],
    private readonly options: {
      readonly primaryTrace?: string | undefined;
      readonly errorPolicy: PipelineObserverErrorPolicy;
    },
  ) {
    const primary =
      options.primaryTrace === undefined
        ? undefined
        : observers.find((entry) => entry.name === options.primaryTrace);
    this.trace =
      primary?.observer.trace === undefined
        ? undefined
        : Object.freeze({ observer: primary.name, ...primary.observer.trace });
  }

  async end(args: PipelineStageEndArgs): Promise<void> {
    await dispatchTerminalObservers(
      this.observers,
      "stage.end",
      (observer) => observer.end(observerSnapshot(args)),
      this.options.errorPolicy,
    );
  }

  async error(args: PipelineStageErrorArgs): Promise<void> {
    await dispatchTerminalObservers(
      this.observers,
      "stage.error",
      (observer) => observer.error?.(observerSnapshot(args)),
      "ignore",
    );
  }
}

async function dispatchTerminalObservers<T>(
  observers: readonly ActiveNamedObserver<T>[],
  phase: string,
  dispatch: (observer: T) => void | Promise<void> | undefined,
  errorPolicy: PipelineObserverErrorPolicy,
): Promise<void> {
  const failures = await terminateObservers(observers, dispatch);
  if (errorPolicy === "throw" && failures.length > 0) {
    throw new PipelineObserverDispatchError(phase, failures);
  }
}

async function terminateObservers<T>(
  observers: readonly ActiveNamedObserver<T>[],
  dispatch: (observer: T) => void | Promise<void> | undefined,
): Promise<PipelineObserverFailure[]> {
  const failures: PipelineObserverFailure[] = [];
  for (const entry of observers) {
    if (entry.terminal) continue;
    entry.terminal = true;
    try {
      await dispatch(entry.observer);
    } catch (error) {
      failures.push({ observer: entry.name, error });
    }
  }
  return failures;
}
