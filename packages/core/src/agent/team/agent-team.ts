import { Agent } from "../agent";
import type { CompletionModel } from "../../completion";
import { assertPositiveSafeInteger } from "../../internal/agent-runtime/run-validation";
import { TeamRun } from "../../internal/team-runtime/run";
import { TeamStream } from "../../internal/team-runtime/stream";
import type {
  AgentTeamLimits,
  AgentTeamMember,
  AgentTeamOptions,
  AgentTeamOutcome,
  AgentTeamRunOptions,
  AgentTeamStream,
} from "./types";

export class AgentTeam<
  Output = string,
  M extends CompletionModel = CompletionModel,
  ContextDocument = unknown,
> {
  readonly id: string;
  readonly members: readonly AgentTeamMember[];
  readonly limits: Readonly<Required<AgentTeamLimits>>;
  private readonly coordinator: Agent<Output, M, ContextDocument>;

  constructor(options: AgentTeamOptions<Output, M, ContextDocument>) {
    this.coordinator = new Agent(options);
    this.id = this.coordinator.id;
    if (!Array.isArray(options.members)) throw new TypeError("AgentTeam requires a members array.");
    const ids = new Set<string>();
    for (const member of options.members) {
      if (!(member instanceof Agent))
        throw new TypeError("AgentTeam members must be Agent instances.");
      if (ids.has(member.id)) throw new TypeError(`Duplicate AgentTeam member ID: ${member.id}`);
      if (!/^[a-zA-Z0-9_-]{1,58}$/.test(member.id))
        throw new TypeError(
          "AgentTeam member IDs must form valid spawn tool names (1–58 letters, digits, underscores, or hyphens).",
        );
      ids.add(member.id);
    }
    const reserved = new Set([
      "send_message",
      "wait_for_agent",
      "list_agents",
      "cancel_agent",
      ...[...ids].map((id) => `spawn_${id}`),
    ]);
    for (const agent of [this.coordinator, ...options.members]) {
      for (const tool of agent.tools) {
        if (reserved.has(tool.name))
          throw new TypeError(`Tool "${tool.name}" conflicts with an AgentTeam tool.`);
      }
    }
    this.members = Object.freeze([...options.members]);
    this.limits = Object.freeze({
      maxConcurrentAgents: assertPositiveSafeInteger(
        options.limits?.maxConcurrentAgents ?? 4,
        "maxConcurrentAgents",
      ),
      maxAgentInstances: assertPositiveSafeInteger(
        options.limits?.maxAgentInstances ?? 12,
        "maxAgentInstances",
      ),
      maxTotalTurns: assertPositiveSafeInteger(
        options.limits?.maxTotalTurns ?? 100,
        "maxTotalTurns",
      ),
      maxBufferedEvents: assertPositiveSafeInteger(
        options.limits?.maxBufferedEvents ?? 1024,
        "maxBufferedEvents",
      ),
    });
  }

  generate(options: AgentTeamRunOptions<Output, M>): Promise<AgentTeamOutcome<Output>> {
    return this.createStream(options, false).result;
  }

  stream(options: AgentTeamRunOptions<Output, M>): AgentTeamStream<Output> {
    return this.createStream(options, true);
  }

  private createStream(
    options: AgentTeamRunOptions<Output, M>,
    streaming: boolean,
  ): AgentTeamStream<Output> {
    if (
      typeof options !== "object" ||
      options === null ||
      (options.prompt === undefined) === (options.messages === undefined)
    ) {
      throw new TypeError("AgentTeam runs require exactly one of prompt or messages.");
    }
    if (
      options.resolveInteraction !== undefined &&
      typeof options.resolveInteraction !== "function"
    ) {
      throw new TypeError("resolveInteraction must be a function.");
    }
    return new TeamStream(
      (emit) =>
        // The scheduler runs heterogeneous definitions. Public inputs are checked against M above.
        new TeamRun(
          this.coordinator,
          this.members,
          this.limits,
          { ...options } as AgentTeamRunOptions<unknown>,
          streaming,
          emit,
        ),
      this.limits.maxBufferedEvents,
    );
  }
}
