import { z } from "zod";
import type { Agent } from "../agent/agent";
import { AgentRunBlockedError } from "../agent/errors";
import type { AgentInput, AgentRunOptions, AgentRunSettings } from "../agent/run-types";
import type {
  CompletionModel,
  CompletionModelControlsOf,
  JsonObject,
  JsonValue,
} from "../completion";
import { decide as decideQuestions } from "../decision/decide";
import type {
  ChoiceQuestion,
  DecideOptions,
  DecisionModel,
  DecisionOptions,
  DecisionQuestions,
  DecisionRawResponseOf,
  DecisionResult,
} from "../decision/types";
import { assertQuestion } from "../decision/validation";
import { type ExtractOptions, extract as extractData } from "../extractor";
import { throwIfAborted } from "../internal/abort";
import { mapWithConcurrency } from "../internal/concurrency";
import type { AgentTraceOptions } from "../observability";
import type { RetrySetting } from "../retry";
import { PipelineAgentSuspensionError } from "./errors";
import {
  appendBranches,
  appendComposedGraph,
  appendStageNode,
  cloneGraph,
  initialPipelineState,
  withOutputNode,
} from "./graph";
import { snapshotPipelineObservability, startPipelineRunObservers } from "./observability";
import {
  childContext,
  combineAbortSignals,
  pipelineAbortError,
  runNode,
  stageContext,
} from "./runtime";
import type {
  ParallelOutput,
  PipelineBatchItem,
  PipelineBatchOptions,
  PipelineExecutor,
  PipelineGraph,
  PipelineGraphNode,
  PipelineNodePath,
  PipelineOptions,
  PipelineRunContext,
  PipelineRunOptions,
  PipelineRunResult,
  PipelineStageContext,
  PipelineStageMetadata,
  PipelineState,
  PipelineTraceInfo,
  RouteOutput,
} from "./types";

const internalPipelineOptions = Symbol("internal-pipeline-options");

type RawResponseOf<Model> =
  Model extends CompletionModel<infer RawResponse> ? RawResponse : unknown;

type PipelineAgentRequest<Output, Model extends CompletionModel> = AgentInput &
  Omit<
    AgentRunSettings<Output, RawResponseOf<Model>, CompletionModelControlsOf<Model>>,
    "abortSignal"
  >;

export type PipelineStepOptions<Input, Output> = PipelineStageMetadata & {
  run(context: PipelineStageContext<Input>): Output | Promise<Output>;
};

export type PipelineComposeOptions<Input, Output> = PipelineStageMetadata & {
  pipeline: Pipeline<Input, Output>;
};

export type PipelineParallelOptions<
  Input,
  Branches extends Record<string, Pipeline<Input, unknown>>,
> = PipelineStageMetadata & {
  branches: Branches;
};

export type PipelineAgentOptions<
  Input,
  AgentOutput,
  Model extends CompletionModel,
> = PipelineStageMetadata & {
  agent: Agent<AgentOutput, Model>;
  request(
    context: PipelineStageContext<Input>,
  ): PipelineAgentRequest<AgentOutput, Model> | Promise<PipelineAgentRequest<AgentOutput, Model>>;
  suspension: "reject";
};

export type PipelineExtractOptions<
  Input,
  Extracted,
  Model extends CompletionModel,
> = PipelineStageMetadata &
  Omit<ExtractOptions<Extracted, Model>, "text" | "abortSignal"> & {
    text(context: PipelineStageContext<Input>): string | Promise<string>;
  };

export type PipelineDecideOptions<
  Input,
  Questions extends DecisionQuestions,
  Model extends DecisionModel,
> = PipelineStageMetadata &
  Omit<DecideOptions<Questions, Model>, "state" | "abortSignal"> & {
    state(context: PipelineStageContext<Input>): JsonValue | Promise<JsonValue>;
  };

/** One Pipeline per option of the route question, keyed by option label. */
export type PipelineRouteBranches<Input, Options extends DecisionOptions> = {
  readonly [Label in Extract<keyof Options, string>]: Pipeline<Input, unknown>;
};

export type PipelineRouteOptions<
  Input,
  Options extends DecisionOptions,
  Model extends DecisionModel,
  Branches extends PipelineRouteBranches<Input, Options>,
> = PipelineStageMetadata & {
  model: Model;
  question: ChoiceQuestion<Options>;
  state(context: PipelineStageContext<Input>): JsonValue | Promise<JsonValue>;
  branches: Branches & { readonly [Extra in Exclude<keyof Branches, keyof Options>]: never };
  retries?: RetrySetting | undefined;
  providerOptions?: JsonObject | undefined;
};

type InternalPipelineOptions<Input, Output> = {
  [internalPipelineOptions]: {
    executor: PipelineExecutor<Input, Output>;
    state: PipelineState;
    observability: PipelineOptions<Input>["observability"];
  };
};

/** Immutable, typed Pipeline with explicit stage and execution boundaries. */
export class Pipeline<Input, Output = Input> {
  readonly id: string;
  readonly name: string | undefined;
  readonly description: string | undefined;
  readonly metadata: JsonObject | undefined;
  readonly observability: PipelineOptions<Input>["observability"];

  private readonly executor: PipelineExecutor<Input, Output>;
  private readonly state: PipelineState;

  constructor(options: PipelineOptions<Input, Output>);
  constructor(options: PipelineOptions<Input, Output> | InternalPipelineOptions<Input, Output>) {
    if (isInternalPipelineOptions(options)) {
      this.executor = options[internalPipelineOptions].executor;
      this.state = options[internalPipelineOptions].state;
      this.observability = options[internalPipelineOptions].observability;
    } else {
      const id = normalizePipelineId(options.id);
      if (!isZodSchema(options.inputSchema)) {
        throw new TypeError("Pipeline inputSchema must be a Zod schema.");
      }
      const inputSchema = options.inputSchema;
      this.executor = (async (input, context) => {
        throwIfAborted(context.abortSignal);
        return inputSchema.parseAsync(input) as Promise<Output>;
      }) as PipelineExecutor<Input, Output>;
      this.state = initialPipelineState({
        id,
        name: options.name,
        description: options.description,
        metadata: options.metadata,
      });
      this.observability = snapshotPipelineObservability(options.observability);
    }

    const graph = this.state.graph;
    this.id = graph.id;
    this.name = graph.name;
    this.description = graph.description;
    this.metadata = graph.metadata;
  }

  step<Next>(options: PipelineStepOptions<Awaited<Output>, Next>): Pipeline<Input, Awaited<Next>> {
    const next = appendStageNode(this.state, "step", options);
    const executor = (async (input, context, pathPrefix) => {
      const value = await this.execute(input, context, pathPrefix);
      const path = [...pathPrefix, next.node.id];
      return (await runNode(context, next.node, path, value, () =>
        options.run(stageContext(value, context)),
      )) as Awaited<Next>;
    }) as PipelineExecutor<Input, Awaited<Next>>;
    return this.derive(executor, next.state);
  }

  compose<Next>(
    options: PipelineComposeOptions<Awaited<Output>, Next>,
  ): Pipeline<Input, Awaited<Next>> {
    const boundary = appendStageNode(this.state, "pipeline", options, {
      defaultLabel: options.pipeline.name ?? options.pipeline.id,
      pipelineId: options.pipeline.id,
    });
    const state = appendComposedGraph(boundary.state, boundary.node, options.pipeline.graph());
    const executor = (async (input, context, pathPrefix) => {
      const value = await this.execute(input, context, pathPrefix);
      const path = [...pathPrefix, boundary.node.id];
      return (await runNode(context, boundary.node, path, value, () =>
        options.pipeline.execute(value, context, path),
      )) as Awaited<Next>;
    }) as PipelineExecutor<Input, Awaited<Next>>;
    return this.derive(executor, state);
  }

  parallel<Branches extends Record<string, Pipeline<Awaited<Output>, unknown>>>(
    options: PipelineParallelOptions<Awaited<Output>, Branches>,
  ): Pipeline<Input, ParallelOutput<Branches>> {
    const branchEntries = normalizeBranches(options.branches, "parallel");
    if (branchEntries.length === 0) {
      throw new TypeError("Pipeline parallel branches must not be empty.");
    }
    const parallel = appendStageNode(this.state, "parallel", options, {
      defaultLabel: `${branchEntries.length} parallel branches`,
    });
    const { state: nextState, nodes: branchNodes } = appendBranches(
      parallel.state,
      parallel.node,
      branchEntries.map(([key, branch]) => [key, branch.graph()] as const),
      "parallel",
    );

    return this.derive<ParallelOutput<Branches>>(async (input, context, pathPrefix) => {
      const value = await this.execute(input, context, pathPrefix);
      const parallelPath = [...pathPrefix, parallel.node.id];
      return runNode(context, parallel.node, parallelPath, value, async () => {
        const controller = new AbortController();
        const combined = combineAbortSignals(context.abortSignal, controller.signal);
        const branchContext = childContext(context, combined.signal);
        let firstError: unknown;
        const promises = branchEntries.map(async ([key, branch]) => {
          const node = branchNodes.get(key) as PipelineGraphNode;
          const path = [...parallelPath, node.id];
          try {
            const output = await runNode(branchContext, node, path, value, () =>
              branch.execute(value, branchContext, path),
            );
            return [key, output] as const;
          } catch (error) {
            if (firstError === undefined) firstError = error;
            if (!controller.signal.aborted) controller.abort(error);
            throw error;
          }
        });

        const settled = await Promise.allSettled(promises);
        combined.dispose();
        if (context.abortSignal?.aborted === true) {
          throw pipelineAbortError(context.abortSignal);
        }
        if (firstError !== undefined) throw firstError;
        return Object.fromEntries(
          settled.map(
            (result) => (result as PromiseFulfilledResult<readonly [string, unknown]>).value,
          ),
        ) as ParallelOutput<Branches>;
      });
    }, nextState);
  }

  agent<AgentOutput, Model extends CompletionModel>(
    options: PipelineAgentOptions<Awaited<Output>, AgentOutput, Model>,
  ): Pipeline<Input, AgentOutput> {
    if (options.suspension !== "reject") {
      throw new TypeError('Pipeline Agent stages require suspension: "reject".');
    }
    const next = appendStageNode(this.state, "agent", options, {
      defaultLabel: options.agent.name ?? options.agent.id,
      agentId: options.agent.id,
      agentName: options.agent.name,
    });
    return this.derive<AgentOutput>(async (input, context, pathPrefix) => {
      const value = await this.execute(input, context, pathPrefix);
      const path = [...pathPrefix, next.node.id];
      return runNode(context, next.node, path, value, async (stageTrace) => {
        const request = await options.request(stageContext(value, context));
        const response = await options.agent.generate({
          ...request,
          trace: withPipelineParentTrace(
            request.trace,
            stageTrace,
            options.agent.observability?.primaryTrace,
          ),
          abortSignal: context.abortSignal,
        } as AgentRunOptions<AgentOutput, RawResponseOf<Model>, CompletionModelControlsOf<Model>>);
        if (response.type === "interaction") {
          throw new PipelineAgentSuspensionError(response);
        }
        if (response.type === "blocked") {
          throw new AgentRunBlockedError(response);
        }
        return response.output;
      });
    }, next.state);
  }

  extract<Extracted, Model extends CompletionModel>(
    options: PipelineExtractOptions<Awaited<Output>, Extracted, Model>,
  ): Pipeline<Input, Extracted> {
    const next = appendStageNode(this.state, "extractor", options);
    return this.derive<Extracted>(async (input, context, pathPrefix) => {
      const value = await this.execute(input, context, pathPrefix);
      const path = [...pathPrefix, next.node.id];
      return runNode(context, next.node, path, value, async () => {
        const text = await options.text(stageContext(value, context));
        const result = await extractData({
          model: options.model,
          text,
          outputSchema: options.outputSchema,
          instructions: options.instructions,
          retries: options.retries,
          temperature: options.temperature,
          maxTokens: options.maxTokens,
          providerOptions: options.providerOptions,
          abortSignal: context.abortSignal,
        });
        return result.output;
      });
    }, next.state);
  }

  /** Answer typed decision questions about the current value. */
  decide<const Questions extends DecisionQuestions, Model extends DecisionModel>(
    options: PipelineDecideOptions<Awaited<Output>, Questions, Model>,
  ): Pipeline<Input, DecisionResult<Questions, DecisionRawResponseOf<Model>>> {
    const next = appendStageNode(this.state, "decision", options);
    return this.derive<DecisionResult<Questions, DecisionRawResponseOf<Model>>>(
      async (input, context, pathPrefix) => {
        const value = await this.execute(input, context, pathPrefix);
        const path = [...pathPrefix, next.node.id];
        return runNode(context, next.node, path, value, async () => {
          const state = await options.state(stageContext(value, context));
          return decideQuestions({
            model: options.model,
            state,
            questions: options.questions,
            retries: options.retries,
            providerOptions: options.providerOptions,
            abortSignal: context.abortSignal,
          });
        });
      },
      next.state,
    );
  }

  /** Choose one branch with a choice decision, then run only that branch. */
  route<
    const Options extends DecisionOptions,
    Model extends DecisionModel,
    Branches extends PipelineRouteBranches<Awaited<Output>, Options>,
  >(
    options: PipelineRouteOptions<Awaited<Output>, Options, Model, Branches>,
  ): Pipeline<Input, RouteOutput<Branches>> {
    assertQuestion(options.question);
    if (options.question.type !== "choice") {
      throw new TypeError("Pipeline route question must be a choice question.");
    }
    const branchEntries = normalizeBranches(
      options.branches as Readonly<Record<string, Pipeline<Awaited<Output>, unknown>>>,
      "route",
    );
    assertRouteBranchesMatchOptions(options.id, branchEntries, options.question.options);
    const route = appendStageNode(this.state, "route", options);
    const { state: nextState, nodes: branchNodes } = appendBranches(
      route.state,
      route.node,
      branchEntries.map(([key, branch]) => [key, branch.graph()] as const),
      "route",
    );
    const branchPipelines = new Map(branchEntries);

    return this.derive<RouteOutput<Branches>>(async (input, context, pathPrefix) => {
      const value = await this.execute(input, context, pathPrefix);
      const routePath = [...pathPrefix, route.node.id];
      return runNode(context, route.node, routePath, value, async () => {
        const state = await options.state(stageContext(value, context));
        const result = await decideQuestions({
          model: options.model,
          state,
          questions: { route: options.question },
          retries: options.retries,
          providerOptions: options.providerOptions,
          abortSignal: context.abortSignal,
        });
        const answer = result.answers.route;
        // decide() validates the choice against the question options, which match the branches.
        const node = branchNodes.get(answer.choice) as PipelineGraphNode;
        const branch = branchPipelines.get(answer.choice) as Pipeline<Awaited<Output>, unknown>;
        const path = [...routePath, node.id];
        const output = await runNode(context, node, path, value, () =>
          branch.execute(value, context, path),
        );
        return (
          result.usage === undefined
            ? { branch: answer.choice, answer, output }
            : { branch: answer.choice, answer, usage: result.usage, output }
        ) as RouteOutput<Branches>;
      });
    }, nextState);
  }

  async run(options: PipelineRunOptions<Input>): Promise<PipelineRunResult<Output>> {
    const runId = normalizeRunId(options.runId ?? globalThis.crypto.randomUUID());
    const startedAt = Date.now();
    const observability = await startPipelineRunObservers(
      this.observability?.observers ?? {},
      {
        runId,
        pipelineId: this.id,
        pipelineName: this.name,
        pipelineDescription: this.description,
        pipelineMetadata: this.metadata,
        runMetadata: options.metadata,
        trace: options.trace,
        input: options.input,
      },
      {
        primaryTrace: this.observability?.primaryTrace,
        errorPolicy: this.observability?.errorPolicy ?? "ignore",
      },
    );
    const context: PipelineRunContext = {
      runId,
      pipelineId: this.id,
      runMetadata: options.metadata,
      abortSignal: options.abortSignal,
      observer: options.observer,
      failOnObserverError: options.failOnObserverError === true,
      observability,
    };
    try {
      throwIfAborted(context.abortSignal);
      const output = await this.execute(options.input, context, []);
      throwIfAborted(context.abortSignal);
      await observability.end({
        runId,
        pipelineId: this.id,
        output,
        durationMs: Date.now() - startedAt,
      });
      return observability.trace === undefined
        ? { runId, output }
        : { runId, output, trace: observability.trace };
    } catch (error) {
      await observability.error({
        runId,
        pipelineId: this.id,
        status: context.abortSignal?.aborted === true ? "cancelled" : "failed",
        error,
        durationMs: Date.now() - startedAt,
      });
      throw error;
    }
  }

  async runBatch(options: PipelineBatchOptions<Input>): Promise<Array<PipelineBatchItem<Output>>> {
    throwIfAborted(options.abortSignal);
    return mapWithConcurrency([...options.inputs], options.concurrency, async (input) => {
      const runId = globalThis.crypto.randomUUID();
      try {
        const result = await this.run({
          input,
          runId,
          metadata: options.metadata,
          trace: options.trace,
          abortSignal: options.abortSignal,
          observer: options.observer,
          failOnObserverError: options.failOnObserverError,
        });
        return { status: "completed", ...result } as const;
      } catch (error) {
        if (options.abortSignal?.aborted === true) {
          throw pipelineAbortError(options.abortSignal);
        }
        return { status: "failed", runId, error } as const;
      }
    });
  }

  graph(): PipelineGraph {
    return cloneGraph(withOutputNode(this.state));
  }

  private derive<DerivedOutput>(
    executor: PipelineExecutor<Input, DerivedOutput>,
    state: PipelineState,
  ): Pipeline<Input, DerivedOutput> {
    return createDerivedPipeline(executor, state, this.observability);
  }

  private async execute(
    input: Input,
    context: PipelineRunContext,
    pathPrefix: PipelineNodePath,
  ): Promise<Awaited<Output>> {
    throwIfAborted(context.abortSignal);
    return (await this.executor(input, context, pathPrefix)) as Awaited<Output>;
  }
}

function createDerivedPipeline<Input, Output>(
  executor: PipelineExecutor<Input, Output>,
  state: PipelineState,
  observability: PipelineOptions<Input>["observability"],
): Pipeline<Input, Output> {
  const options: InternalPipelineOptions<Input, Output> = {
    [internalPipelineOptions]: { executor, state, observability },
  };
  return new Pipeline<Input, Output>(options as unknown as PipelineOptions<Input, Output>);
}

function withPipelineParentTrace(
  trace: AgentTraceOptions | undefined,
  parent: PipelineTraceInfo | undefined,
  agentPrimaryTrace: string | undefined,
): AgentTraceOptions | undefined {
  if (parent?.traceId === undefined) return trace;
  if (parent.observer !== agentPrimaryTrace) return trace;
  if (trace?.traceId !== undefined && trace.traceId !== parent.traceId) return trace;
  const resolved = { ...trace, traceId: parent.traceId };
  if (trace?.parentObservationId === undefined && parent.observationId !== undefined) {
    resolved.parentObservationId = parent.observationId;
  }
  return resolved;
}

function isInternalPipelineOptions<Input, Output>(
  options: PipelineOptions<Input, Output> | InternalPipelineOptions<Input, Output>,
): options is InternalPipelineOptions<Input, Output> {
  return internalPipelineOptions in options;
}

function isZodSchema(value: unknown): value is z.ZodType {
  return value instanceof z.ZodType;
}

function normalizePipelineId(id: string): string {
  if (typeof id !== "string") {
    throw new TypeError("Pipeline id must be a string.");
  }
  const normalized = id.trim();
  if (normalized.length === 0) {
    throw new TypeError("Pipeline id must be a non-empty string.");
  }
  return normalized;
}

function normalizeRunId(runId: string): string {
  if (typeof runId !== "string") {
    throw new TypeError("Pipeline runId must be a string.");
  }
  const normalized = runId.trim();
  if (normalized.length === 0) {
    throw new TypeError("Pipeline runId must be a non-empty string.");
  }
  return normalized;
}

function normalizeBranches<Branch>(
  branches: Readonly<Record<string, Branch>>,
  kind: "parallel" | "route",
): Array<readonly [string, Branch]> {
  const entries: Array<readonly [string, Branch]> = [];
  const ids = new Set<string>();
  for (const key of Object.keys(branches)) {
    const pipeline = branches[key] as Branch;
    const id = key.trim();
    if (id.length === 0) {
      throw new TypeError(`Pipeline ${kind} branch id must be a non-empty string.`);
    }
    if (ids.has(id)) {
      throw new TypeError(`Pipeline ${kind} branch id "${id}" is already registered.`);
    }
    ids.add(id);
    if (id !== key) {
      throw new TypeError(`Pipeline ${kind} branch ids must not contain surrounding whitespace.`);
    }
    entries.push([id, pipeline]);
  }
  return entries;
}

function assertRouteBranchesMatchOptions(
  routeId: string,
  branchEntries: ReadonlyArray<readonly [string, unknown]>,
  options: DecisionOptions,
): void {
  const branchKeys = new Set(branchEntries.map(([key]) => key));
  for (const label of Object.keys(options)) {
    if (!branchKeys.has(label)) {
      throw new TypeError(`Pipeline route "${routeId}" is missing a branch for option "${label}".`);
    }
  }
  for (const key of branchKeys) {
    if (!Object.hasOwn(options, key)) {
      throw new TypeError(
        `Pipeline route "${routeId}" branch "${key}" is not an option of its question.`,
      );
    }
  }
}
