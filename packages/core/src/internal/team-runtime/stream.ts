import type { AgentSteerInput, AgentSteerReceipt } from "../../agent/run-types";
import type { AgentTeamEvent, AgentTeamOutcome, AgentTeamStream } from "../../agent/team/types";
import { AgentTeamLimitError } from "../../agent/team/errors";
import { createAsyncQueue } from "../async-queue";
import type { TeamRun } from "./run";

/** Events and final promises share one consumption mode, matching AgentStream. */
export class TeamStream<Output> implements AgentTeamStream<Output> {
  private readonly queue = createAsyncQueue<AgentTeamEvent<Output>>();
  private readonly run: TeamRun<Output>;
  private promise: Promise<AgentTeamOutcome<Output>> | undefined;
  private mode: "events" | "result" | undefined;
  private iterating = false;
  private bufferedEvents = 0;
  private bufferError: AgentTeamLimitError | undefined;

  constructor(
    createRun: (emit: (event: AgentTeamEvent<Output>) => void) => TeamRun<Output>,
    maxBufferedEvents: number,
  ) {
    this.run = createRun((event) => {
      if (this.mode !== "events" || this.bufferError !== undefined) return;
      if (this.bufferedEvents >= maxBufferedEvents) {
        // Set the error before cancelling: cancellation emits further member events.
        this.bufferError = new AgentTeamLimitError("maxBufferedEvents");
        this.queue.throw(this.bufferError, { discardPending: true });
        this.run.cancel("Agent team stream exceeded maxBufferedEvents.");
        return;
      }
      this.bufferedEvents += 1;
      this.queue.enqueue(event);
    });
  }

  get events(): AsyncIterable<AgentTeamEvent<Output>> {
    return this;
  }
  get textStream(): AsyncIterable<string> {
    return this.consumeText();
  }
  get result(): Promise<AgentTeamOutcome<Output>> {
    // Let a synchronous event subscription win, as with AgentStream.result.
    if (this.mode === undefined)
      queueMicrotask(() => {
        this.mode ??= "result";
      });
    return this.start();
  }
  get text(): Promise<string> {
    return this.result.then((outcome) => outcome.text);
  }

  steer(input: AgentSteerInput): AgentSteerReceipt {
    return this.run.steer(input);
  }
  cancel(reason?: string): void {
    this.run.cancel(reason);
  }

  [Symbol.asyncIterator](): AsyncIterator<AgentTeamEvent<Output>> {
    return this.consume();
  }

  private start(): Promise<AgentTeamOutcome<Output>> {
    if (this.promise === undefined) {
      this.promise = this.run.execute().then(
        (outcome) => {
          // Overflow can occur while publishing the terminal outcome, after the run closes.
          if (this.bufferError !== undefined) throw this.bufferError;
          return outcome;
        },
        (error: unknown) => {
          throw this.bufferError ?? error;
        },
      );
      // Observe failures for iterator-only consumers. queue.throw records the error and returns.
      this.promise.then(
        () => this.queue.close(),
        (error: unknown) => this.queue.throw(error),
      );
    }
    return this.promise;
  }

  private async *consume(): AsyncIterableIterator<AgentTeamEvent<Output>> {
    if (this.mode !== undefined || this.iterating)
      throw new Error("Agent team stream already has a consumer.");
    this.mode = "events";
    this.iterating = true;
    void this.start();
    let completed = false;
    try {
      for await (const event of this.queue) {
        if (this.bufferError !== undefined) throw this.bufferError;
        this.bufferedEvents -= 1;
        yield event;
      }
      completed = true;
    } finally {
      if (!completed) {
        this.mode = "result";
        this.run.cancel("Agent team stream consumer closed.");
        this.queue.close({ discardPending: true });
      }
      this.iterating = false;
    }
  }

  private async *consumeText(): AsyncIterableIterator<string> {
    for await (const event of this) {
      if (event.type === "agent_event" && event.coordinator && event.event.type === "text_delta")
        yield event.event.delta;
    }
  }
}
