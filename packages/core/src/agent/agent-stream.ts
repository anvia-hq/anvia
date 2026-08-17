import type { CompletionModel } from "../completion";
import type { AgentRun } from "../internal/agent-runtime/agent-run";
import type {
  AgentSteerInput,
  AgentSteerReceipt,
  AgentStream,
  AgentStreamEvent,
} from "./run-types";

type RawResponseOf<Model> =
  Model extends CompletionModel<infer RawResponse> ? RawResponse : unknown;

export function createAgentStream<Output, M extends CompletionModel>(
  run: AgentRun<Output, M>,
): AgentStream<AgentStreamEvent<Output, RawResponseOf<M>>> {
  return new DefaultAgentStream(run);
}

class DefaultAgentStream<Output, M extends CompletionModel>
  implements AgentStream<AgentStreamEvent<Output, RawResponseOf<M>>>
{
  private consuming = false;
  private completed = false;

  constructor(private readonly run: AgentRun<Output, M>) {}

  steer(input: AgentSteerInput): AgentSteerReceipt {
    return this.run.steer(input);
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
        yield event;
      }
    } finally {
      if (!this.completed) {
        this.run.cancel("Agent stream consumer closed the stream.");
      }
      this.consuming = false;
      this.completed = true;
    }
  }
}
