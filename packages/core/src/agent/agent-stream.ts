import type { CompletionModel } from "../completion";
import type { AgentRun } from "../internal/agent-runtime/agent-run";
import type {
  AgentOutcome,
  AgentSteerInput,
  AgentSteerReceipt,
  AgentStream,
  AgentStreamEvent,
} from "./run-types";

type RawResponseOf<Model> =
  Model extends CompletionModel<infer RawResponse> ? RawResponse : unknown;

export function createAgentStream<Output, M extends CompletionModel>(
  run: AgentRun<Output, M>,
): AgentStream<Output, RawResponseOf<M>> {
  return new DefaultAgentStream(run);
}

class DefaultAgentStream<Output, M extends CompletionModel> implements AgentStream<
  Output,
  RawResponseOf<M>
> {
  private consuming = false;
  private completed = false;
  private settled = false;
  private drainScheduled = false;
  private readonly resultPromise: Promise<AgentOutcome<Output>>;
  private readonly textPromise: Promise<string>;
  private readonly resolveResult: (result: AgentOutcome<Output>) => void;
  private readonly rejectResult: (error: unknown) => void;

  constructor(private readonly run: AgentRun<Output, M>) {
    let resolveResult!: (result: AgentOutcome<Output>) => void;
    let rejectResult!: (error: unknown) => void;
    this.resultPromise = new Promise<AgentOutcome<Output>>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });
    this.resolveResult = resolveResult;
    this.rejectResult = rejectResult;
    this.textPromise = this.resultPromise.then((result) => result.text);
    void this.resultPromise.catch(() => undefined);
    void this.textPromise.catch(() => undefined);
  }

  get events(): AsyncIterable<AgentStreamEvent<Output, RawResponseOf<M>>> {
    return this;
  }

  get textStream(): AsyncIterable<string> {
    return {
      [Symbol.asyncIterator]: () => this.consumeText(),
    };
  }

  get text(): Promise<string> {
    this.scheduleDrain();
    return this.textPromise;
  }

  get result(): Promise<AgentOutcome<Output>> {
    this.scheduleDrain();
    return this.resultPromise;
  }

  steer(input: AgentSteerInput): AgentSteerReceipt {
    return this.run.steer(input);
  }

  cancel(reason = "Agent stream cancelled."): void {
    this.run.cancel(reason);
  }

  [Symbol.asyncIterator](): AsyncIterator<AgentStreamEvent<Output, RawResponseOf<M>>> {
    return this.consume()[Symbol.asyncIterator]();
  }

  private async *consume(): AsyncIterableIterator<AgentStreamEvent<Output, RawResponseOf<M>>> {
    if (this.completed) {
      throw new Error("Agent stream has already been consumed.");
    }
    if (this.consuming) {
      throw new Error("Agent stream is already running.");
    }
    this.consuming = true;
    try {
      for await (const event of this.run.events()) {
        if (isAgentOutcome(event)) {
          this.settled = true;
          this.resolveResult(event);
        } else if (event.type === "error") {
          this.settled = true;
          this.rejectResult(event.error);
        }
        yield event;
      }
    } finally {
      if (!this.completed) {
        const cancellation = this.run.cancel("Agent stream consumer closed the stream.");
        if (!this.settled && cancellation !== undefined) {
          this.settled = true;
          this.rejectResult(cancellation);
        }
      }
      this.consuming = false;
      this.completed = true;
    }
  }

  private async *consumeText(): AsyncIterableIterator<string> {
    for await (const event of this.consume()) {
      if (event.type === "text_delta") yield event.delta;
    }
  }

  private scheduleDrain(): void {
    if (this.completed || this.consuming || this.drainScheduled) return;
    this.drainScheduled = true;
    queueMicrotask(() => {
      this.drainScheduled = false;
      if (this.completed || this.consuming) return;
      void this.drain();
    });
  }

  private async drain(): Promise<void> {
    try {
      for await (const _event of this.consume()) {
        // Accessing a final promise consumes unobserved stream events.
      }
    } catch (error) {
      if (!this.settled) {
        this.settled = true;
        this.rejectResult(error);
      }
    }
  }
}

function isAgentOutcome<Output>(
  event: AgentStreamEvent<Output, unknown>,
): event is AgentOutcome<Output> {
  return event.type === "response" || event.type === "interaction" || event.type === "blocked";
}
