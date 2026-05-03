import type {
  AgentGenerationEndArgs,
  AgentGenerationErrorArgs,
  AgentGenerationObserver,
  AgentGenerationStartArgs,
  AgentObserver,
  AgentRunEndArgs,
  AgentRunErrorArgs,
  AgentRunObserver,
  AgentRunStartArgs,
  AgentToolEndArgs,
  AgentToolErrorArgs,
  AgentToolObserver,
  AgentToolStartArgs,
  JsonObject,
  JsonValue,
} from "@anvia/core";
import type {
  StudioTrace,
  StudioTraceObservation,
  StudioTraceStatus,
  StudioTraceStore,
} from "../types";

export type StudioTraceObserverOptions = {
  store: StudioTraceStore | (() => StudioTraceStore | undefined) | undefined;
};

export class StudioTraceObserver implements AgentObserver {
  constructor(private readonly options: StudioTraceObserverOptions) {}

  startRun(args: AgentRunStartArgs): AgentRunObserver {
    const traceId = args.trace?.traceId ?? globalThis.crypto.randomUUID().replaceAll("-", "");
    const observationId = globalThis.crypto.randomUUID().replaceAll("-", "").slice(0, 16);
    return new StudioRunTraceObserver({
      id: traceId,
      observationId,
      args,
      store: this.store(),
    });
  }

  private store(): StudioTraceStore | undefined {
    return typeof this.options.store === "function" ? this.options.store() : this.options.store;
  }
}

class StudioRunTraceObserver implements AgentRunObserver {
  readonly trace: { traceId: string; observationId: string };
  private readonly startedAt = new Date();
  private readonly observations: StudioTraceObservation[] = [];

  constructor(
    private readonly props: {
      id: string;
      observationId: string;
      args: AgentRunStartArgs;
      store: StudioTraceStore | undefined;
    },
  ) {
    this.trace = { traceId: props.id, observationId: props.observationId };
  }

  startGeneration(args: AgentGenerationStartArgs): AgentGenerationObserver {
    const startedAt = new Date();
    return {
      end: (endArgs: AgentGenerationEndArgs) => {
        this.observations.push(
          traceObservation({
            kind: "generation",
            name: `model.turn.${args.turn}`,
            status: "success",
            turn: args.turn,
            startedAt,
            input: toJsonValue(args.request),
            output: toJsonValue(endArgs.response),
            metadata: {
              model: args.request.model ?? "default",
              toolCount: args.request.tools.length,
              ...(endArgs.firstDeltaMs === undefined ? {} : { firstDeltaMs: endArgs.firstDeltaMs }),
            },
          }),
        );
      },
      error: (errorArgs: AgentGenerationErrorArgs) => {
        this.observations.push(
          traceObservation({
            kind: "generation",
            name: `model.turn.${args.turn}`,
            status: "error",
            turn: args.turn,
            startedAt,
            input: toJsonValue(args.request),
            error: serializeError(errorArgs.error),
            metadata: {
              model: args.request.model ?? "default",
              toolCount: args.request.tools.length,
            },
          }),
        );
      },
    };
  }

  startTool(args: AgentToolStartArgs): AgentToolObserver {
    const startedAt = new Date();
    return {
      end: (endArgs: AgentToolEndArgs) => {
        this.observations.push(
          traceObservation({
            kind: "tool",
            name: args.toolName,
            status: "success",
            turn: args.turn,
            startedAt,
            input: parseOrString(args.args),
            output: parseOrString(endArgs.result),
            metadata: toolMetadata(args, endArgs.skipped),
          }),
        );
      },
      error: (errorArgs: AgentToolErrorArgs) => {
        this.observations.push(
          traceObservation({
            kind: "tool",
            name: args.toolName,
            status: "error",
            turn: args.turn,
            startedAt,
            input: parseOrString(args.args),
            error: serializeError(errorArgs.error),
            metadata: toolMetadata(args, false),
          }),
        );
      },
    };
  }

  async end(args: AgentRunEndArgs): Promise<void> {
    await this.save("success", {
      endedAt: new Date(),
      output: args.output,
      usage: args.usage,
      messages: toJsonValue(args.messages),
    });
  }

  async error(args: AgentRunErrorArgs): Promise<void> {
    await this.save("error", {
      endedAt: new Date(),
      error: serializeError(args.error),
      usage: args.usage,
      messages: toJsonValue(args.messages),
    });
  }

  private async save(
    status: StudioTraceStatus,
    result: {
      endedAt: Date;
      output?: string;
      error?: JsonValue;
      usage: StudioTrace["usage"];
      messages: JsonValue;
    },
  ): Promise<void> {
    const sessionId = this.props.args.trace?.sessionId;
    const store = this.props.store;
    if (sessionId === undefined || store === undefined) {
      return;
    }

    const metadata = traceMetadata(this.props.args, result.messages);
    const trace: StudioTrace = {
      id: this.props.id,
      sessionId,
      ...(this.props.args.trace?.name === undefined ? {} : { name: this.props.args.trace.name }),
      status,
      trace: this.trace,
      startedAt: this.startedAt.toISOString(),
      endedAt: result.endedAt.toISOString(),
      durationMs: durationMs(this.startedAt, result.endedAt),
      input: toJsonValue({
        instructions: this.props.args.instructions,
        prompt: this.props.args.prompt,
        history: this.props.args.history,
      }),
      ...(result.output === undefined ? {} : { output: result.output }),
      ...(result.error === undefined ? {} : { error: result.error }),
      ...(result.usage === undefined ? {} : { usage: result.usage }),
      metadata,
      observations: this.observations,
      observationCount: this.observations.length,
    };

    await store.saveTrace(trace);
  }
}

function traceObservation(props: {
  kind: StudioTraceObservation["kind"];
  name: string;
  status: StudioTraceStatus;
  turn: number;
  startedAt: Date;
  input?: JsonValue;
  output?: JsonValue;
  error?: JsonValue;
  metadata?: JsonObject;
}): StudioTraceObservation {
  const endedAt = new Date();
  return {
    id: globalThis.crypto.randomUUID(),
    kind: props.kind,
    name: props.name,
    status: props.status,
    turn: props.turn,
    startedAt: props.startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationMs: durationMs(props.startedAt, endedAt),
    ...(props.input === undefined ? {} : { input: props.input }),
    ...(props.output === undefined ? {} : { output: props.output }),
    ...(props.error === undefined ? {} : { error: props.error }),
    ...(props.metadata === undefined ? {} : { metadata: props.metadata }),
  };
}

function traceMetadata(args: AgentRunStartArgs, messages: JsonValue): JsonObject {
  return compactJsonObject({
    agentName: args.agentName,
    agentDescription: args.agentDescription,
    maxTurns: args.maxTurns,
    userId: args.trace?.userId,
    tags: args.trace?.tags,
    version: args.trace?.version,
    metadata: toJsonValue(args.trace?.metadata ?? {}),
    messages,
  });
}

function toolMetadata(args: AgentToolStartArgs, skipped: boolean): JsonObject {
  return compactJsonObject({
    internalCallId: args.internalCallId,
    toolCallId: args.toolCallId,
    skipped,
  });
}

function compactJsonObject(values: Record<string, unknown>): JsonObject {
  const entries = Object.entries(values).flatMap(([key, value]) =>
    value === undefined ? [] : [[key, toJsonValue(value)]],
  );
  return Object.fromEntries(entries) as JsonObject;
}

function durationMs(startedAt: Date, endedAt: Date): number {
  return Math.max(0, endedAt.getTime() - startedAt.getTime());
}

function parseOrString(value: string): JsonValue {
  try {
    return toJsonValue(JSON.parse(value));
  } catch {
    return value;
  }
}

function serializeError(error: unknown): JsonValue {
  if (error instanceof Error) {
    return compactJsonObject({
      name: error.name,
      message: error.message,
      stack: error.stack,
    });
  }
  return toJsonValue(error);
}

function toJsonValue(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (value === undefined) {
    return null;
  }
  if (Array.isArray(value)) {
    return value.map((item) => toJsonValue(item));
  }
  if (typeof value === "object") {
    return compactJsonObject(value as Record<string, unknown>);
  }
  return String(value);
}
