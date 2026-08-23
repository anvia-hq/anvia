import { type Agent, isVectorContext, type VectorContext } from "@anvia/core/agent";
import type { Document } from "@anvia/core/completion";

export function staticContextDocuments(agent: Agent): Document[] {
  return agent.context.filter((input): input is Document => !isVectorContext(input));
}

export function vectorContexts(agent: Agent): VectorContext[] {
  return agent.context.filter(isVectorContext);
}
