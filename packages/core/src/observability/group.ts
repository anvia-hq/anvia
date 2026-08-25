import { Usage } from "../completion";
import { observerSnapshot } from "./snapshot";
import type {
  AgentGenerationEndArgs,
  AgentGenerationErrorArgs,
  AgentGenerationObserver,
  AgentGenerationStartArgs,
  AgentGenerationUpdateArgs,
  AgentObserverErrorPolicy,
  AgentObserverMap,
  AgentRunEndArgs,
  AgentRunErrorArgs,
  AgentRunEventArgs,
  AgentRunObserver,
  AgentRunStartArgs,
  AgentToolEndArgs,
  AgentToolErrorArgs,
  AgentToolObserver,
  AgentToolStartArgs,
  AgentToolStreamEventArgs,
  AgentToolSuspendedArgs,
  AgentTraceInfo,
} from "./types";

export type AgentObserverFailure = {
  readonly observer: string;
  readonly error: unknown;
};

export class AgentObserverDispatchError extends AggregateError {
  readonly phase: string;
  readonly failures: readonly AgentObserverFailure[];

  constructor(phase: string, failures: readonly AgentObserverFailure[]) {
    super(
      failures.map((failure) => failure.error),
      `Agent observer ${phase} failed for ${failures.map((failure) => failure.observer).join(", ")}.`,
    );
    this.name = "AgentObserverDispatchError";
    this.phase = phase;
    this.failures = Object.freeze([...failures]);
  }
}

type NamedObserver<T> = {
  readonly name: string;
  readonly observer: T;
};

type ActiveNamedObserver<T> = NamedObserver<T> & {
  terminal: boolean;
};

export async function startAgentRunObservers(
  observers: AgentObserverMap,
  args: AgentRunStartArgs,
  options: {
    readonly primaryTrace?: string | undefined;
    readonly errorPolicy: AgentObserverErrorPolicy;
  },
): Promise<ActiveAgentRunObservers> {
  const runObservers: ActiveNamedObserver<AgentRunObserver>[] = [];
  const failures: AgentObserverFailure[] = [];
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
    const startupError = new AgentObserverDispatchError("startRun", failures);
    const cleanupFailures = await terminateObservers(runObservers, (observer) =>
      observer.error?.(
        observerSnapshot({
          status: "failed",
          error: startupError,
          usage: Usage.empty(),
          messages: [...args.history, args.prompt],
        }),
      ),
    );
    throw new AgentObserverDispatchError("startRun", [...failures, ...cleanupFailures]);
  }
  return new ActiveAgentRunObservers(runObservers, options);
}

export class ActiveAgentRunObservers {
  readonly trace: AgentTraceInfo | undefined;

  constructor(
    private readonly runObservers: readonly ActiveNamedObserver<AgentRunObserver>[],
    private readonly options: {
      readonly primaryTrace?: string | undefined;
      readonly errorPolicy: AgentObserverErrorPolicy;
    },
  ) {
    const primary =
      options.primaryTrace === undefined
        ? undefined
        : runObservers.find((entry) => entry.name === options.primaryTrace);
    this.trace =
      primary?.observer.trace === undefined
        ? undefined
        : Object.freeze({ observer: primary.name, ...primary.observer.trace });
  }

  async startGeneration(args: AgentGenerationStartArgs): Promise<ActiveGenerationObservers> {
    const generationObservers: ActiveNamedObserver<AgentGenerationObserver>[] = [];
    const failures: AgentObserverFailure[] = [];
    for (const entry of this.runObservers) {
      if (entry.observer.startGeneration === undefined) continue;
      try {
        const observer = await entry.observer.startGeneration(observerSnapshot(args));
        if (observer !== undefined) {
          generationObservers.push({ name: entry.name, observer, terminal: false });
        }
      } catch (error) {
        failures.push({ observer: entry.name, error });
      }
    }
    if (this.options.errorPolicy === "throw" && failures.length > 0) {
      const startupError = new AgentObserverDispatchError("startGeneration", failures);
      const cleanupFailures = await terminateObservers(generationObservers, (observer) =>
        observer.error?.(observerSnapshot({ turn: args.turn, error: startupError })),
      );
      throw new AgentObserverDispatchError("startGeneration", [...failures, ...cleanupFailures]);
    }
    return new ActiveGenerationObservers(generationObservers, this.options.errorPolicy);
  }

  async startTool(args: AgentToolStartArgs): Promise<ActiveToolObservers> {
    const toolObservers: ActiveNamedObserver<AgentToolObserver>[] = [];
    const failures: AgentObserverFailure[] = [];
    for (const entry of this.runObservers) {
      if (entry.observer.startTool === undefined) continue;
      try {
        const observer = await entry.observer.startTool(observerSnapshot(args));
        if (observer !== undefined) {
          toolObservers.push({ name: entry.name, observer, terminal: false });
        }
      } catch (error) {
        failures.push({ observer: entry.name, error });
      }
    }
    if (this.options.errorPolicy === "throw" && failures.length > 0) {
      const startupError = new AgentObserverDispatchError("startTool", failures);
      const cleanupFailures = await terminateObservers(toolObservers, (observer) =>
        observer.error?.(observerSnapshot({ ...args, error: startupError })),
      );
      throw new AgentObserverDispatchError("startTool", [...failures, ...cleanupFailures]);
    }
    return new ActiveToolObservers(toolObservers, this.options.errorPolicy);
  }

  async end(args: AgentRunEndArgs): Promise<void> {
    await dispatchTerminalObservers(
      this.runObservers,
      "end",
      (observer) => observer.end(observerSnapshot(args)),
      this.options.errorPolicy,
    );
  }

  async error(args: AgentRunErrorArgs): Promise<void> {
    await dispatchTerminalObservers(
      this.runObservers,
      "error",
      (observer) => observer.error?.(observerSnapshot(args)),
      "ignore",
    );
  }

  async event(args: AgentRunEventArgs): Promise<void> {
    await dispatchObservers(
      this.runObservers,
      "event",
      (observer) => observer.event?.(observerSnapshot(args)),
      this.options.errorPolicy,
    );
  }
}

export class ActiveGenerationObservers {
  constructor(
    private readonly observers: readonly ActiveNamedObserver<AgentGenerationObserver>[],
    private readonly errorPolicy: AgentObserverErrorPolicy,
  ) {}

  async end(args: AgentGenerationEndArgs): Promise<void> {
    await dispatchTerminalObservers(
      this.observers,
      "generation.end",
      (observer) => observer.end(observerSnapshot(args)),
      this.errorPolicy,
    );
  }

  async error(args: AgentGenerationErrorArgs): Promise<void> {
    await dispatchTerminalObservers(
      this.observers,
      "generation.error",
      (observer) => observer.error?.(observerSnapshot(args)),
      "ignore",
    );
  }

  async update(args: AgentGenerationUpdateArgs): Promise<void> {
    await dispatchObservers(
      this.observers,
      "generation.update",
      (observer) => observer.update?.(observerSnapshot(args)),
      this.errorPolicy,
    );
  }
}

export class ActiveToolObservers {
  constructor(
    private readonly observers: readonly ActiveNamedObserver<AgentToolObserver>[],
    private readonly errorPolicy: AgentObserverErrorPolicy,
  ) {}

  async streamEvent(args: AgentToolStreamEventArgs): Promise<void> {
    await dispatchObservers(
      this.observers,
      "tool.streamEvent",
      (observer) => observer.streamEvent?.(observerSnapshot(args)),
      this.errorPolicy,
    );
  }

  async end(args: AgentToolEndArgs): Promise<void> {
    await dispatchTerminalObservers(
      this.observers,
      "tool.end",
      (observer) => observer.end(observerSnapshot(args)),
      this.errorPolicy,
    );
  }

  async suspend(args: AgentToolSuspendedArgs): Promise<void> {
    await dispatchTerminalObservers(
      this.observers,
      "tool.suspend",
      (observer) => observer.suspend?.(observerSnapshot(args)),
      this.errorPolicy,
    );
  }

  async error(args: AgentToolErrorArgs): Promise<void> {
    await dispatchTerminalObservers(
      this.observers,
      "tool.error",
      (observer) => observer.error?.(observerSnapshot(args)),
      "ignore",
    );
  }
}

async function dispatchObservers<T>(
  observers: readonly NamedObserver<T>[],
  phase: string,
  dispatch: (observer: T) => void | Promise<void> | undefined,
  errorPolicy: AgentObserverErrorPolicy,
): Promise<void> {
  const failures: AgentObserverFailure[] = [];
  for (const entry of observers) {
    try {
      await dispatch(entry.observer);
    } catch (error) {
      failures.push({ observer: entry.name, error });
    }
  }
  throwObserverFailures(phase, failures, errorPolicy);
}

async function dispatchTerminalObservers<T>(
  observers: readonly ActiveNamedObserver<T>[],
  phase: string,
  dispatch: (observer: T) => void | Promise<void> | undefined,
  errorPolicy: AgentObserverErrorPolicy,
): Promise<void> {
  const failures = await terminateObservers(observers, dispatch);
  throwObserverFailures(phase, failures, errorPolicy);
}

async function terminateObservers<T>(
  observers: readonly ActiveNamedObserver<T>[],
  dispatch: (observer: T) => void | Promise<void> | undefined,
): Promise<AgentObserverFailure[]> {
  const failures: AgentObserverFailure[] = [];
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

function throwObserverFailures(
  phase: string,
  failures: readonly AgentObserverFailure[],
  errorPolicy: AgentObserverErrorPolicy,
): void {
  if (errorPolicy === "throw" && failures.length > 0) {
    throw new AgentObserverDispatchError(phase, failures);
  }
}
