import { z } from "zod";
import { isStreamingCompletionModel } from "../completion/generate-completion";
import type { CompletionModel } from "../completion/index";
import { createTool } from "../tool/create-tool";
import type { Tool, ToolCallContext, ToolCallStreamEvent } from "../tool/tool";
import type { Agent } from "./agent";
import { AgentRunBlockedError, AgentToolSuspensionError } from "./errors";
import type { AgentToolOptions } from "./types";

export function createAgentTool<Output, M extends CompletionModel, ContextDocument>(
  agent: Agent<Output, M, ContextDocument>,
  options: AgentToolOptions,
): Tool<{ prompt: string }, Output> {
  if (options.suspension !== "reject") {
    throw new TypeError('Agent.asTool() requires suspension: "reject".');
  }
  const description =
    options.description ?? agent.description ?? `Prompt the ${options.name} agent.`;

  return createTool({
    name: options.name,
    description,
    inputSchema: z.object({
      prompt: z.string().describe("The prompt to send to the agent."),
    }),
    execute: async ({ prompt }, context: ToolCallContext) => {
      if (
        options.stream === true &&
        context.emitStreamEvent !== undefined &&
        agent.model.capabilities.streaming &&
        isStreamingCompletionModel(agent.model)
      ) {
        let completed = false;
        let output!: Output;
        const childStream = agent.stream({
          prompt,
          maxTurns: options.maxTurns,
          abortSignal: context.abortSignal,
        });
        for await (const event of childStream) {
          const streamEvent: ToolCallStreamEvent = {
            agentId: agent.id,
            event,
          };
          if (agent.name !== undefined) {
            streamEvent.agentName = agent.name;
          }
          await context.emitStreamEvent(streamEvent);
          if (event.type === "error") {
            throw event.error;
          }
          if (event.type === "final") {
            if (event.result.status === "suspended") {
              throw new AgentToolSuspensionError(event.result);
            }
            if (event.result.status === "blocked") {
              throw new AgentRunBlockedError(event.result);
            }
            output = event.result.output;
            completed = true;
          }
        }
        if (!completed) {
          throw new Error(`Agent tool "${options.name}" ended without a final result.`);
        }
        return output;
      }
      const response = await agent.generate({
        prompt,
        maxTurns: options.maxTurns,
        abortSignal: context.abortSignal,
      });
      if (response.status === "suspended") {
        throw new AgentToolSuspensionError(response);
      }
      if (response.status === "blocked") {
        throw new AgentRunBlockedError(response);
      }
      return response.output;
    },
  });
}
