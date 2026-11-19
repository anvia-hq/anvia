import type { DurableRun } from "./run.js";
import type { DurableSubmitClient } from "./client.js";
import type { DurableSubmission, DurableSubmitOptions } from "./types.js";

/**
 * A registered agent bound to its runtime. It removes the `agentId` string from submissions and
 * carries the agent's output type to `DurableRun.result()`.
 */
export class DurableAgentHandle<Output> {
  constructor(
    readonly id: string,
    private readonly runtime: DurableSubmitClient,
  ) {}

  async submit(
    input: Omit<DurableSubmission, "agentId">,
    options: DurableSubmitOptions = {},
  ): Promise<DurableRun<Output>> {
    const run = await this.runtime.submit({ ...input, agentId: this.id }, options);
    return run as DurableRun<Output>;
  }
}
