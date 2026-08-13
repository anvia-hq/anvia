import { type Agent, type ContextIndex, isContextIndex } from "@anvia/core/agent";
import type { Document } from "@anvia/core/completion";

export function staticContextDocuments(agent: Agent): Document[] {
  return agent.context.filter((input): input is Document => !isContextIndex(input));
}

export function contextIndexes(agent: Agent): ContextIndex[] {
  return agent.context.filter(isContextIndex);
}
