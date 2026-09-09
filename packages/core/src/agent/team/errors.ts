export class AgentTeamLimitError extends Error {
  constructor(readonly limit: string) {
    super(`Agent team reached ${limit}.`);
    this.name = "AgentTeamLimitError";
  }
}

export class AgentTeamInteractionError extends Error {
  constructor(
    readonly instanceId: string,
    options?: ErrorOptions,
  ) {
    super(
      `Agent team interaction for "${instanceId}" could not be resolved. Configure resolveInteraction.`,
      options,
    );
    this.name = "AgentTeamInteractionError";
  }
}
