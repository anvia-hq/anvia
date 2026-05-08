import type { Agent } from "../agent";
import type { CompletionModel, JsonObject } from "../completion";
import type { Extractor } from "../extractor";

/** Minimal interface for anything that can run as a pipeline stage. */
export interface PipelineOp<Input = unknown, Output = unknown> {
  run(input: Input): Output | Promise<Output>;
}

export interface PipelineBatchOptions {
  /** Maximum number of inputs processed at the same time. */
  concurrency: number;
}

type AwaitedOutput<Op> = Op extends PipelineOp<unknown, infer Output> ? Awaited<Output> : never;

type ParallelOutput<Branches extends Record<string, PipelineOp<unknown, unknown>>> = {
  [Key in keyof Branches]: AwaitedOutput<Branches[Key]>;
};

export type PipelineMetadata = {
  id?: string | undefined;
  name?: string | undefined;
  description?: string | undefined;
  metadata?: JsonObject | undefined;
};

export type PipelineStageMetadata = {
  id?: string | undefined;
  name?: string | undefined;
  description?: string | undefined;
  metadata?: JsonObject | undefined;
};

export type PipelineStageKind =
  | "input"
  | "step"
  | "pipeline"
  | "parallel"
  | "branch"
  | "agent"
  | "extractor"
  | "output";

export type PipelineGraphNode = {
  id: string;
  kind: PipelineStageKind;
  label: string;
  description?: string | undefined;
  metadata?: JsonObject | undefined;
  agentId?: string | undefined;
  agentName?: string | undefined;
  pipelineId?: string | undefined;
  branchKey?: string | undefined;
};

export type PipelineGraphEdge = {
  id: string;
  source: string;
  target: string;
  label?: string | undefined;
};

export type PipelineGraph = PipelineMetadata & {
  id: string;
  nodes: PipelineGraphNode[];
  edges: PipelineGraphEdge[];
};

export type PipelineRunEvent =
  | {
      type: "stage_started";
      node: PipelineGraphNode;
    }
  | {
      type: "stage_completed";
      node: PipelineGraphNode;
      durationMs: number;
    }
  | {
      type: "stage_failed";
      node: PipelineGraphNode;
      durationMs: number;
      error: unknown;
    };

export type PipelineRunObserver = {
  onEvent(event: PipelineRunEvent): void | Promise<void>;
};

export type PipelineRunOptions = {
  observer?: PipelineRunObserver | undefined;
};

type PipelineRunContext = {
  observer?: PipelineRunObserver | undefined;
};

type PipelineExecutor<Input, Output> = (
  input: Input,
  context: PipelineRunContext,
) => Output | Promise<Output>;

type PipelineBuilderState = {
  graph: PipelineGraph;
  terminalNodeId: string;
  terminalNodeIds: string[];
  nextNodeIndex: number;
  nextEdgeIndex: number;
};

/** Runnable pipeline returned by `PipelineBuilder.build()`. */
export class Pipeline<Input, Output> implements PipelineOp<Input, Awaited<Output>> {
  readonly id: string;
  readonly name: string | undefined;
  readonly description: string | undefined;
  readonly metadata: JsonObject | undefined;

  constructor(
    private readonly executor: PipelineExecutor<Input, Output>,
    private readonly pipelineGraph: PipelineGraph = initialGraph({}),
  ) {
    this.id = pipelineGraph.id;
    this.name = pipelineGraph.name;
    this.description = pipelineGraph.description;
    this.metadata = pipelineGraph.metadata;
  }

  /** Run one input through the built pipeline and return the final stage output. */
  async run(input: Input, options: PipelineRunOptions = {}): Promise<Awaited<Output>> {
    return (await this.executor(input, { observer: options.observer })) as Awaited<Output>;
  }

  /** Run many inputs through the same pipeline with bounded concurrency. */
  async batch<I extends Iterable<Input>>(
    inputs: I,
    options: PipelineBatchOptions,
  ): Promise<Array<Awaited<Output>>> {
    return mapWithConcurrency([...inputs], options.concurrency, (input) => this.run(input));
  }

  graph(): PipelineGraph {
    return cloneGraph(this.pipelineGraph);
  }
}

/** Builds a typed pipeline from an original input type to an inferred output type. */
export class PipelineBuilder<Input, Output = Input> {
  private readonly executor: PipelineExecutor<Input, Output>;
  private readonly state: PipelineBuilderState;

  constructor();
  constructor(metadata: PipelineMetadata);
  constructor(executor: (input: Input) => Output | Promise<Output>);
  constructor(executor: PipelineExecutor<Input, Output>, state: PipelineBuilderState);
  constructor(
    metadataOrExecutor?:
      | PipelineMetadata
      | ((input: Input) => Output | Promise<Output>)
      | PipelineExecutor<Input, Output>,
    state?: PipelineBuilderState,
  ) {
    if (state !== undefined) {
      this.executor = metadataOrExecutor as PipelineExecutor<Input, Output>;
      this.state = state;
      return;
    }

    if (typeof metadataOrExecutor === "function") {
      const executor = metadataOrExecutor as (input: Input) => Output | Promise<Output>;
      this.executor = ((input) => executor(input)) as PipelineExecutor<Input, Output>;
      this.state = initialBuilderState({});
      return;
    }

    this.executor = identity as PipelineExecutor<Input, Output>;
    this.state = initialBuilderState(metadataOrExecutor ?? {});
  }

  /** Add a synchronous or asynchronous transform stage. */
  step<Next>(
    fn: (input: Awaited<Output>) => Next | Promise<Next>,
    metadata?: PipelineStageMetadata,
  ): PipelineBuilder<Input, Awaited<Next>> {
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
    return new PipelineBuilder<Input, Awaited<Next>>(
      async (input, context): Promise<Awaited<Next>> => {
        const value = await this.runStep(input, context);
        const result = await runNode(context, next.node, () => fn(value));
        return result as Awaited<Next>;
      },
      next.state,
    );
  }

  /** Compose another pipeline operation after the current stage. */
  use<Next>(
    op: PipelineOp<Awaited<Output>, Next>,
    metadata?: PipelineStageMetadata,
  ): PipelineBuilder<Input, Awaited<Next>> {
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
    return new PipelineBuilder<Input, Awaited<Next>>(
      async (input, context): Promise<Awaited<Next>> => {
        const value = await this.runStep(input, context);
        const result = await runNode(context, next.node, () => op.run(value));
        return result as Awaited<Next>;
      },
      next.state,
    );
  }

  /** Run named branch operations concurrently from the current value. */
  parallel<Branches extends Record<string, PipelineOp<Awaited<Output>, unknown>>>(
    branches: Branches,
    metadata?: PipelineStageMetadata,
  ): PipelineBuilder<Input, ParallelOutput<Branches>> {
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

    return new PipelineBuilder<Input, ParallelOutput<Branches>>(async (input, context) => {
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
  prompt(
    agent: Agent<CompletionModel>,
    metadata?: PipelineStageMetadata,
  ): PipelineBuilder<Input, string> {
    const next = appendNode(this.state, "agent", metadata?.name ?? agent.name ?? agent.id, {
      description: metadata?.description ?? agent.description,
      metadata: metadata?.metadata,
      preferredId: metadata?.id,
      agentId: agent.id,
      agentName: agent.name,
    });
    return new PipelineBuilder<Input, string>(async (input, context) => {
      const value = await this.runStep(input, context);
      return runNode(context, next.node, async () => {
        const response = await agent.prompt(String(value)).send();
        return response.output;
      });
    }, next.state);
  }

  /** Send the current value to an extractor as text and continue with typed schema data. */
  extract<T>(
    extractor: Extractor<T, CompletionModel>,
    metadata?: PipelineStageMetadata,
  ): PipelineBuilder<Input, T> {
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
    return new PipelineBuilder<Input, T>(async (input, context) => {
      const value = await this.runStep(input, context);
      return runNode(context, next.node, () => extractor.extract(String(value)));
    }, next.state);
  }

  /** Finish the builder and return a runnable pipeline. */
  build(): Pipeline<Input, Awaited<Output>> {
    const graph = withOutputNode(this.state);
    return new Pipeline<Input, Awaited<Output>>(
      (input, context) => this.runStep(input, context) as Promise<Awaited<Output>>,
      graph,
    );
  }

  private async runStep(input: Input, context: PipelineRunContext): Promise<Awaited<Output>> {
    return (await this.executor(input, context)) as Awaited<Output>;
  }
}

function initialBuilderState(metadata: PipelineMetadata): PipelineBuilderState {
  return {
    graph: initialGraph(metadata),
    terminalNodeId: "input",
    terminalNodeIds: ["input"],
    nextNodeIndex: 1,
    nextEdgeIndex: 1,
  };
}

function initialGraph(metadata: PipelineMetadata): PipelineGraph {
  const id = normalizeId(metadata.id ?? "pipeline");
  return {
    id,
    ...(metadata.name === undefined ? {} : { name: metadata.name }),
    ...(metadata.description === undefined ? {} : { description: metadata.description }),
    ...(metadata.metadata === undefined ? {} : { metadata: metadata.metadata }),
    nodes: [{ id: "input", kind: "input", label: "Input" }],
    edges: [],
  };
}

function appendNode(
  state: PipelineBuilderState,
  kind: PipelineStageKind,
  label: string,
  options: {
    description?: string | undefined;
    metadata?: JsonObject | undefined;
    preferredId?: string | undefined;
    agentId?: string | undefined;
    agentName?: string | undefined;
    pipelineId?: string | undefined;
  } = {},
): { state: PipelineBuilderState; node: PipelineGraphNode } {
  const node = graphNode(kind, label, state.nextNodeIndex, {
    ...options,
    existingIds: new Set(state.graph.nodes.map((item) => item.id)),
  });
  return {
    node,
    state: appendGraphNode(state, node, activeTerminalNodeIds(state), [node.id]),
  };
}

function appendChildNode(
  state: PipelineBuilderState,
  parentId: string,
  kind: PipelineStageKind,
  label: string,
  options: {
    branchKey?: string | undefined;
  } = {},
): { state: PipelineBuilderState; node: PipelineGraphNode } {
  const node = graphNode(kind, label, state.nextNodeIndex, {
    ...options,
    existingIds: new Set(state.graph.nodes.map((item) => item.id)),
  });
  return {
    node,
    state: appendGraphNode(state, node, [parentId], activeTerminalNodeIds(state)),
  };
}

function appendGraphNode(
  state: PipelineBuilderState,
  node: PipelineGraphNode,
  sourceIds: string[],
  terminalNodeIds: string[],
): PipelineBuilderState {
  const edges = sourceIds.map((sourceId, index) => ({
    id: `edge_${state.nextEdgeIndex + index}`,
    source: sourceId,
    target: node.id,
  }));
  const terminalNodeId = terminalNodeIds.at(-1) ?? state.terminalNodeId;
  return {
    graph: {
      ...state.graph,
      nodes: [...state.graph.nodes, node],
      edges: [...state.graph.edges, ...edges],
    },
    terminalNodeId,
    terminalNodeIds,
    nextNodeIndex: state.nextNodeIndex + 1,
    nextEdgeIndex: state.nextEdgeIndex + edges.length,
  };
}

function activeTerminalNodeIds(state: PipelineBuilderState): string[] {
  return state.terminalNodeIds.length > 0 ? state.terminalNodeIds : [state.terminalNodeId];
}

function withTerminalNodes(
  state: PipelineBuilderState,
  terminalNodeIds: string[],
): PipelineBuilderState {
  return {
    ...state,
    terminalNodeId: terminalNodeIds.at(-1) ?? state.terminalNodeId,
    terminalNodeIds,
  };
}

function graphNode(
  kind: PipelineStageKind,
  label: string,
  index: number,
  options: {
    description?: string | undefined;
    metadata?: JsonObject | undefined;
    preferredId?: string | undefined;
    agentId?: string | undefined;
    agentName?: string | undefined;
    pipelineId?: string | undefined;
    branchKey?: string | undefined;
    existingIds?: Set<string> | undefined;
  } = {},
): PipelineGraphNode {
  const id = uniqueGraphNodeId(
    normalizeId(options.preferredId ?? `${kind}_${index}`),
    options.existingIds ?? new Set(),
  );
  return {
    id,
    kind,
    label,
    ...(options.description === undefined ? {} : { description: options.description }),
    ...(options.metadata === undefined ? {} : { metadata: options.metadata }),
    ...(options.agentId === undefined ? {} : { agentId: options.agentId }),
    ...(options.agentName === undefined ? {} : { agentName: options.agentName }),
    ...(options.pipelineId === undefined ? {} : { pipelineId: options.pipelineId }),
    ...(options.branchKey === undefined ? {} : { branchKey: options.branchKey }),
  };
}

function withOutputNode(state: PipelineBuilderState): PipelineGraph {
  const graph = cloneGraph(state.graph);
  if (graph.nodes.some((node) => node.id === "output")) {
    return graph;
  }
  graph.nodes.push({ id: "output", kind: "output", label: "Output" });
  graph.edges.push(
    ...activeTerminalNodeIds(state).map((sourceId, index) => ({
      id: `edge_${state.nextEdgeIndex + index}`,
      source: sourceId,
      target: "output",
    })),
  );
  return graph;
}

async function runNode<Output>(
  context: PipelineRunContext,
  node: PipelineGraphNode,
  fn: () => Output | Promise<Output>,
): Promise<Awaited<Output>> {
  const startedAt = Date.now();
  await context.observer?.onEvent({ type: "stage_started", node });
  try {
    const output = (await fn()) as Awaited<Output>;
    await context.observer?.onEvent({
      type: "stage_completed",
      node,
      durationMs: Date.now() - startedAt,
    });
    return output;
  } catch (error) {
    await context.observer?.onEvent({
      type: "stage_failed",
      node,
      durationMs: Date.now() - startedAt,
      error,
    });
    throw error;
  }
}

function nextStageLabel(state: PipelineBuilderState, prefix: string): string {
  return `${prefix} ${state.nextNodeIndex}`;
}

function cloneGraph(graph: PipelineGraph): PipelineGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((node) => ({ ...node })),
    edges: graph.edges.map((edge) => ({ ...edge })),
  };
}

function normalizeId(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized.length === 0 ? "pipeline" : normalized;
}

function uniqueGraphNodeId(baseId: string, existingIds: Set<string>): string {
  let id = baseId;
  let suffix = 2;
  while (existingIds.has(id)) {
    id = `${baseId}_${suffix}`;
    suffix += 1;
  }
  return id;
}

function identity<T>(input: T): T {
  return input;
}

async function mapWithConcurrency<Input, Output>(
  inputs: Input[],
  concurrency: number,
  fn: (input: Input) => Promise<Output>,
): Promise<Output[]> {
  const limit = Math.max(1, Math.trunc(concurrency));
  const results = new Array<Output>(inputs.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < inputs.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await fn(inputs[index] as Input);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, inputs.length) }, () => worker()));
  return results;
}
