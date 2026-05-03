import type { Agent } from "../agent";
import type { CompletionModel } from "../completion";
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

/** Runnable pipeline returned by `PipelineBuilder.build()`. */
export class Pipeline<Input, Output> implements PipelineOp<Input, Awaited<Output>> {
  constructor(private readonly executor: (input: Input) => Output | Promise<Output>) {}

  /** Run one input through the built pipeline and return the final stage output. */
  async run(input: Input): Promise<Awaited<Output>> {
    return await this.executor(input);
  }

  /** Run many inputs through the same pipeline with bounded concurrency. */
  async batch<I extends Iterable<Input>>(
    inputs: I,
    options: PipelineBatchOptions,
  ): Promise<Array<Awaited<Output>>> {
    return mapWithConcurrency([...inputs], options.concurrency, (input) => this.run(input));
  }
}

/** Builds a typed pipeline from an original input type to an inferred output type. */
export class PipelineBuilder<Input, Output = Input> {
  constructor(
    private readonly executor: (input: Input) => Output | Promise<Output> = identity as (
      input: Input,
    ) => Output,
  ) {}

  /** Add a synchronous or asynchronous transform stage. */
  step<Next>(
    fn: (input: Awaited<Output>) => Next | Promise<Next>,
  ): PipelineBuilder<Input, Awaited<Next>> {
    return new PipelineBuilder<Input, Awaited<Next>>(async (input): Promise<Awaited<Next>> => {
      const result = await fn(await this.runStep(input));
      return result as Awaited<Next>;
    });
  }

  /** Compose another pipeline operation after the current stage. */
  use<Next>(op: PipelineOp<Awaited<Output>, Next>): PipelineBuilder<Input, Awaited<Next>> {
    return new PipelineBuilder<Input, Awaited<Next>>(async (input): Promise<Awaited<Next>> => {
      const result = await op.run(await this.runStep(input));
      return result as Awaited<Next>;
    });
  }

  /** Run named branch operations concurrently from the current value. */
  parallel<Branches extends Record<string, PipelineOp<Awaited<Output>, unknown>>>(
    branches: Branches,
  ): PipelineBuilder<Input, ParallelOutput<Branches>> {
    return new PipelineBuilder<Input, ParallelOutput<Branches>>(async (input) => {
      const value = await this.runStep(input);
      const entries = await Promise.all(
        Object.entries(branches).map(async ([key, op]) => [key, await op.run(value)] as const),
      );
      return Object.fromEntries(entries) as ParallelOutput<Branches>;
    });
  }

  /** Send the current value to an agent as text and continue with the agent output. */
  prompt(agent: Agent<CompletionModel>): PipelineBuilder<Input, string> {
    return this.step(async (input) => {
      const response = await agent.prompt(String(input)).send();
      return response.output;
    });
  }

  /** Send the current value to an extractor as text and continue with typed schema data. */
  extract<T>(extractor: Extractor<T, CompletionModel>): PipelineBuilder<Input, T> {
    return this.step((input) => extractor.extract(String(input)));
  }

  /** Finish the builder and return a runnable pipeline. */
  build(): Pipeline<Input, Awaited<Output>> {
    return new Pipeline<Input, Awaited<Output>>((input) => this.runStep(input));
  }

  private async runStep(input: Input): Promise<Awaited<Output>> {
    return (await this.executor(input)) as Awaited<Output>;
  }
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
