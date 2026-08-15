import { z } from "zod";
import { type Agent, cancelAgentApproval } from "../agent/agent";
import { AgentRunBlockedError } from "../agent/errors";
import type { CompletionModel, JsonObject } from "../completion";
import type { Extractor } from "../extractor";
import { mapWithConcurrency } from "../internal/concurrency";
import {
  appendChildNode,
  appendNode,
  cloneGraph,
  initialPipelineState,
  nextStageLabel,
  withOutputNode,
  withTerminalNodes,
} from "./graph";
import { runNode } from "./runtime";
import type {
  ParallelOutput,
  PipelineBatchOptions,
  PipelineExecutor,
  PipelineGraph,
  PipelineGraphNode,
  PipelineOp,
  PipelineOptions,
  PipelineRunContext,
  PipelineRunOptions,
  PipelineStageMetadata,
  PipelineState,
} from "./types";

const internalPipelineOptions = Symbol("internal-pipeline-options");

type InternalPipelineOptions<Input, Output> = {
  [internalPipelineOptions]: {
    executor: PipelineExecutor<Input, Output>;
    state: PipelineState;
  };
};

/** Immutable, typed pipeline that can be composed and run directly. */
export class Pipeline<Input, Output = Input> implements PipelineOp<Input, Awaited<Output>> {
  readonly id: string;
  readonly name: string | undefined;
  readonly description: string | undefined;
  readonly metadata: JsonObject | undefined;

  private readonly executor: PipelineExecutor<Input, Output>;
  private readonly state: PipelineState;

  constructor(options: PipelineOptions<Input, Output>);
  constructor(options: PipelineOptions<Input, Output> | InternalPipelineOptions<Input, Output>) {
    if (isInternalPipelineOptions(options)) {
      this.executor = options[internalPipelineOptions].executor;
      this.state = options[internalPipelineOptions].state;
    } else {
      const id = normalizePipelineId(options.id);
      if (!isZodSchema(options.inputSchema)) {
        throw new TypeError("Pipeline inputSchema must be a Zod schema.");
      }
      const inputSchema = options.inputSchema;
      this.executor = ((input) => inputSchema.parse(input)) as PipelineExecutor<Input, Output>;
      this.state = initialPipelineState({
        id,
        name: options.name,
        description: options.description,
        metadata: options.metadata,
      });
    }

    const graph = this.state.graph;
    this.id = graph.id;
    this.name = graph.name;
    this.description = graph.description;
    this.metadata = graph.metadata;
  }

  /** Add a synchronous or asynchronous transform stage. */
  step<Next>(
    fn: (input: Awaited<Output>) => Next | Promise<Next>,
    metadata?: PipelineStageMetadata,
  ): Pipeline<Input, Awaited<Next>> {
    const next = appendNode(
      this.state,
      "step",
      metadata?.name ?? nextStageLabel(this.state, "Step"),
      {
        description: metadata?.description,
        metadata: metadata?.metadata,
        preferredId: metadata?.id,
      },
    );
    return this.derive<Awaited<Next>>(async (input, context): Promise<Awaited<Next>> => {
      const value = await this.runStep(input, context);
      const result = await runNode(context, next.node, () => fn(value));
      return result as Awaited<Next>;
    }, next.state);
  }

  /** Compose another pipeline operation after the current stage. */
  use<Next>(
    op: PipelineOp<Awaited<Output>, Next>,
    metadata?: PipelineStageMetadata,
  ): Pipeline<Input, Awaited<Next>> {
    const nested = op instanceof Pipeline ? op : undefined;
    const next = appendNode(
      this.state,
      nested === undefined ? "step" : "pipeline",
      metadata?.name ??
        nested?.name ??
        nested?.id ??
        nextStageLabel(this.state, nested === undefined ? "Operation" : "Pipeline"),
      {
        description: metadata?.description ?? nested?.description,
        metadata: metadata?.metadata ?? nested?.metadata,
        preferredId: metadata?.id,
        pipelineId: nested?.id,
      },
    );
    return this.derive<Awaited<Next>>(async (input, context): Promise<Awaited<Next>> => {
      const value = await this.runStep(input, context);
      const result = await runNode(context, next.node, () => op.run(value));
      return result as Awaited<Next>;
    }, next.state);
  }

  /** Run named branch operations concurrently from the current value. */
  parallel<Branches extends Record<string, PipelineOp<Awaited<Output>, unknown>>>(
    branches: Branches,
    metadata?: PipelineStageMetadata,
  ): Pipeline<Input, ParallelOutput<Branches>> {
    const parallel = appendNode(
      this.state,
      "parallel",
      metadata?.name ?? `${Object.keys(branches).length} parallel branches`,
      {
        description: metadata?.description,
        metadata: metadata?.metadata,
        preferredId: metadata?.id,
      },
    );
    let nextState = parallel.state;
    const branchNodes: Record<string, PipelineGraphNode> = {};
    for (const key of Object.keys(branches)) {
      const branch = appendChildNode(nextState, parallel.node.id, "branch", key, {
        branchKey: key,
      });
      nextState = branch.state;
      branchNodes[key] = branch.node;
    }
    nextState = withTerminalNodes(
      nextState,
      Object.values(branchNodes).map((node) => node.id),
    );

    return this.derive<ParallelOutput<Branches>>(async (input, context) => {
      const value = await this.runStep(input, context);
      const entries = await runNode(context, parallel.node, () =>
        Promise.all(
          Object.entries(branches).map(async ([key, op]) => {
            const node = branchNodes[key] as PipelineGraphNode;
            const output = await runNode(context, node, () => op.run(value));
            return [key, output] as const;
          }),
        ),
      );
      return Object.fromEntries(entries) as ParallelOutput<Branches>;
    }, nextState);
  }

  /** Send the current value to an agent as text and continue with the agent output. */
  agent<AgentOutput, Model extends CompletionModel>(
    agent: Agent<AgentOutput, Model>,
    metadata?: PipelineStageMetadata,
  ): Pipeline<Input, AgentOutput> {
    const next = appendNode(this.state, "agent", metadata?.name ?? agent.name ?? agent.id, {
      description: metadata?.description ?? agent.description,
      metadata: metadata?.metadata,
      preferredId: metadata?.id,
      agentId: agent.id,
      agentName: agent.name,
    });
    return this.derive<AgentOutput>(async (input, context) => {
      const value = await this.runStep(input, context);
      return runNode(context, next.node, async () => {
        const response = await agent.generate(String(value));
        if (response.status === "approval_required") {
          await cancelAgentApproval(
            response,
            "Pipeline agent stages cannot suspend for tool approval.",
          );
          throw new Error("Pipeline agent stages cannot suspend for tool approval.");
        }
        if (response.status === "blocked") {
          throw new AgentRunBlockedError(response);
        }
        return response.output;
      });
    }, next.state);
  }

  /** Send the current value to an extractor as text and continue with typed schema data. */
  extract<T>(
    extractor: Extractor<T, CompletionModel>,
    metadata?: PipelineStageMetadata,
  ): Pipeline<Input, T> {
    const next = appendNode(
      this.state,
      "extractor",
      metadata?.name ?? nextStageLabel(this.state, "Extractor"),
      {
        description: metadata?.description,
        metadata: metadata?.metadata,
        preferredId: metadata?.id,
      },
    );
    return this.derive<T>(async (input, context) => {
      const value = await this.runStep(input, context);
      return runNode(context, next.node, () => extractor.extract(String(value)));
    }, next.state);
  }

  /** Run one input through the pipeline and return the final stage output. */
  async run(input: Input, options: PipelineRunOptions = {}): Promise<Awaited<Output>> {
    return this.runStep(input, { observer: options.observer });
  }

  /** Run many inputs through the same pipeline with bounded concurrency. */
  async batch<I extends Iterable<Input>>(
    inputs: I,
    options: PipelineBatchOptions,
  ): Promise<Array<Awaited<Output>>> {
    return mapWithConcurrency([...inputs], options.concurrency, (input) => this.run(input));
  }

  /** Return an isolated graph snapshot for the current pipeline stages. */
  graph(): PipelineGraph {
    return cloneGraph(withOutputNode(this.state));
  }

  private derive<DerivedOutput>(
    executor: PipelineExecutor<Input, DerivedOutput>,
    state: PipelineState,
  ): Pipeline<Input, DerivedOutput> {
    return createDerivedPipeline(executor, state);
  }

  private async runStep(input: Input, context: PipelineRunContext): Promise<Awaited<Output>> {
    return (await this.executor(input, context)) as Awaited<Output>;
  }
}

function createDerivedPipeline<Input, Output>(
  executor: PipelineExecutor<Input, Output>,
  state: PipelineState,
): Pipeline<Input, Output> {
  const options: InternalPipelineOptions<Input, Output> = {
    [internalPipelineOptions]: { executor, state },
  };
  return new Pipeline<Input, Output>(options as unknown as PipelineOptions<Input, Output>);
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
