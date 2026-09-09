import type { AgentTeamMember, AgentTeamOptions } from "../../agent/team/types";
import type { TeamMember } from "./member";

/** Validated definition permissions, shared by every instance in a run. */
export class TeamPolicy {
  private readonly siblings: boolean;
  private readonly spawning = new Map<AgentTeamMember, readonly AgentTeamMember[]>();

  constructor(
    private readonly catalog: readonly AgentTeamMember[],
    communication: AgentTeamOptions["communication"],
    spawning: AgentTeamOptions["spawning"],
  ) {
    if (
      communication !== undefined &&
      (communication === null ||
        typeof communication !== "object" ||
        Array.isArray(communication) ||
        (communication.siblings !== undefined && typeof communication.siblings !== "boolean"))
    )
      throw new TypeError("AgentTeam communication.siblings must be a boolean.");
    this.siblings = communication?.siblings ?? false;
    if (spawning !== undefined && !Array.isArray(spawning))
      throw new TypeError("AgentTeam spawning must be an array.");
    for (const rule of spawning ?? []) {
      if (rule === null || typeof rule !== "object" || !catalog.includes(rule.from))
        throw new TypeError("Spawn rule from must reference a registered Agent instance.");
      if (this.spawning.has(rule.from))
        throw new TypeError(`Duplicate spawn rule for "${rule.from.id}".`);
      if (
        !Array.isArray(rule.to) ||
        [...rule.to].some((target: AgentTeamMember) => !catalog.includes(target))
      )
        throw new TypeError("Spawn rule to must contain registered Agent instances.");
      if (new Set(rule.to).size !== rule.to.length)
        throw new TypeError(`Duplicate spawn target for "${rule.from.id}".`);
      this.spawning.set(rule.from, Object.freeze([...rule.to]));
    }
  }

  spawnTargets(member: TeamMember): readonly AgentTeamMember[] {
    return member.parentInstanceId === undefined
      ? this.catalog
      : (this.spawning.get(member.definition) ?? []);
  }

  canAccess(caller: TeamMember, target: TeamMember): boolean {
    return (
      caller === target ||
      target.instanceId === caller.parentInstanceId ||
      target.parentInstanceId === caller.instanceId ||
      (this.siblings &&
        caller.parentInstanceId !== undefined &&
        target.parentInstanceId === caller.parentInstanceId)
    );
  }
}
