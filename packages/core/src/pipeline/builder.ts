import { z } from "zod";
import type { Agent } from "../agent/agent";
import type { CompletionModel } from "../completion";
import type { Extractor } from "../extractor";
import {
  appendChildNode,
  appendNode,
  initialBuilderState,
  nextStageLabel,
  withOutputNode,
  withTerminalNodes,
} from "./graph";
import { Pipeline } from "./pipeline";
import { runNode } from "./runtime";
import type {
  ParallelOutput,
  PipelineBuilderState,
  PipelineExecutor,
  PipelineGraphNode,
  PipelineMetadata,
  PipelineOp,
  PipelineRunContext,
  PipelineStageMetadata,
} from "./types";

/** Builds a typed pipeline from an original input type to an inferred output type. */
export class PipelineBuilder<Input, Output = Input> {
  private readonly executor: PipelineExecutor<Input, Output>;
  private readonly state: PipelineBuilderState;

  constructor(schema: z.ZodType<Output, Input>);
  constructor(schema: z.ZodType<Output, Input>, metadata: PipelineMetadata);
  constructor(executor: (input: Input) => Output | Promise<Output>);
  constructor(executor: PipelineExecutor<Input, Output>, state: PipelineBuilderState);
  constructor(
    metadataOrExecutor?:
      | PipelineMetadata
      | z.ZodType
      | ((input: Input) => Output | Promise<Output>)
      | PipelineExecutor<Input, Output>,
    stateOrMetadata?: PipelineBuilderState | PipelineMetadata,
  ) {
    if (stateOrMetadata !== undefined && isBuilderState(stateOrMetadata)) {
      this.executor = metadataOrExecutor as PipelineExecutor<Input, Output>;
      this.state = stateOrMetadata;
      return;
    }

    if (typeof metadataOrExecutor === "function") {
      const executor = metadataOrExecutor as (input: Input) => Output | Promise<Output>;
      this.executor = ((input) => executor(input)) as PipelineExecutor<Input, Output>;
      this.state = initialBuilderState({});
      return;
    }

    if (isZodSchema(metadataOrExecutor)) {
      const schema = metadataOrExecutor;
      const metadata: PipelineMetadata =
        stateOrMetadata !== undefined && isPipelineMetadata(stateOrMetadata) ? stateOrMetadata : {};
      this.executor = ((input) => schema.parse(input)) as PipelineExecutor<Input, Output>;
      this.state = initialBuilderState(metadata);
      return;
    }

    this.executor = identity as PipelineExecutor<Input, Output>;
    this.state = initialBuilderState((metadataOrExecutor as PipelineMetadata | undefined) ?? {});
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

function identity<T>(input: T): T {
  return input;
}

function isZodSchema(value: unknown): value is z.ZodType {
  return value instanceof z.ZodType;
}

function isBuilderState(value: unknown): value is PipelineBuilderState {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    "graph" in candidate &&
    "terminalNodeId" in candidate &&
    "terminalNodeIds" in candidate &&
    "nextNodeIndex" in candidate &&
    "nextEdgeIndex" in candidate
  );
}

function isPipelineMetadata(value: unknown): value is PipelineMetadata {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    "id" in candidate ||
    "name" in candidate ||
    "description" in candidate ||
    "metadata" in candidate
  );
}
