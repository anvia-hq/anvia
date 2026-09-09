import type { AgentTeam, AgentTeamInteraction, AgentTeamStream } from "@anvia/core/agent";
import {
  assertAgentInteractionResponse,
  type AgentInteractionResponse,
} from "@anvia/core/agent/interactions";
import type { StudioTeamRunEvent, StudioTeamRunRequest } from "../team-types";
import type { StudioRunLease } from "./run-lifecycle";

type PendingInteraction = {
  request: AgentTeamInteraction;
  resolve(response: AgentInteractionResponse): void;
  reject(error: Error): void;
};

/** Owns one live team and its application-only interaction responses. */
export class StudioTeamRun {
  readonly id = crypto.randomUUID();
  private readonly stream: AgentTeamStream<unknown>;
  private readonly pending = new Map<string, PendingInteraction>();
  private readonly claimed = new Set<string>();
  private readonly iterator: AsyncIterator<import("@anvia/core/agent").AgentTeamEvent<unknown>>;
  private readonly first: ReturnType<typeof this.iterator.next>;
  private finished = false;

  constructor(
    readonly teamId: string,
    team: AgentTeam<unknown>,
    input: StudioTeamRunRequest,
    lease: StudioRunLease,
    onFinish: () => void,
  ) {
    this.stream = team.stream({
      ...input,
      abortSignal: lease.abortSignal,
      resolveInteraction: (request) => this.requestInteraction(request),
    });
    // Subscribe before reading result so core retains event consumption and bounds unread events.
    this.iterator = this.stream.events[Symbol.asyncIterator]();
    this.first = this.iterator.next();
    void this.first.catch(() => undefined);
    const finish = () => {
      this.finished = true;
      for (const interaction of this.pending.values())
        interaction.reject(new Error("Team run ended."));
      this.pending.clear();
      this.claimed.clear();
      lease.finish();
      onFinish();
    };
    void this.stream.result.then(finish, finish);
  }

  steer(input: StudioTeamRunRequest) {
    if (input.prompt !== undefined) return this.stream.steer({ prompt: input.prompt });
    const messages = input.messages.filter((message) => message.role === "user");
    if (messages.length !== input.messages.length)
      throw new TypeError("Steering accepts only user messages.");
    return this.stream.steer({ messages });
  }
  cancel() {
    this.stream.cancel("Team run cancelled in Studio.");
  }

  respond(id: string, response: AgentInteractionResponse): "accepted" | "missing" | "claimed" {
    if (this.claimed.has(id)) return "claimed";
    const pending = this.pending.get(id);
    if (pending === undefined) return "missing";
    assertAgentInteractionResponse(pending.request.interaction, response);
    this.claimed.add(id);
    pending.resolve(response);
    return "accepted";
  }

  events(): AsyncIterable<StudioTeamRunEvent> {
    const iterator = this.consume();
    return {
      [Symbol.asyncIterator]: () => ({
        next: () => iterator.next(),
        return: async () => {
          // Abort first: returning an async generator waits behind a pending next().
          this.cancel();
          return iterator.return();
        },
      }),
    };
  }

  private async *consume(): AsyncGenerator<StudioTeamRunEvent, void> {
    try {
      yield { type: "team_run_started", teamId: this.teamId, runId: this.id };
      let next = await this.first;
      while (!next.done) {
        // The attributed interaction event is sufficient; continuation state stays on the server.
        if (next.value.type !== "agent_event" || next.value.event.type !== "interaction")
          yield next.value;
        next = await this.iterator.next();
      }
    } finally {
      if (!this.finished) this.cancel();
      await this.iterator.return?.();
    }
  }

  private requestInteraction(request: AgentTeamInteraction): Promise<AgentInteractionResponse> {
    const id = request.interaction.id;
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        this.pending.delete(id);
        request.abortSignal.removeEventListener("abort", abort);
      };
      const abort = () => {
        cleanup();
        reject(new Error("Team interaction cancelled."));
      };
      if (request.abortSignal.aborted || this.finished) {
        abort();
        return;
      }
      if (this.pending.has(id) || this.claimed.has(id)) {
        reject(new Error("Duplicate interaction ID."));
        return;
      }
      this.pending.set(id, {
        request,
        resolve: (response) => {
          cleanup();
          resolve(response);
        },
        reject: (error) => {
          cleanup();
          reject(error);
        },
      });
      request.abortSignal.addEventListener("abort", abort, { once: true });
    });
  }
}
