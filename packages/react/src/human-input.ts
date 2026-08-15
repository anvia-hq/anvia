import type { ToolApproval, ToolQuestion } from "@anvia/client";
import type { ToolApprovalDecisionInput, ToolQuestionAnswerInput } from "./types";

type HumanInputEndpointOptions = { endpoint?: string | URL; fetch?: typeof fetch };

export async function defaultDecideApproval(
  input: ToolApprovalDecisionInput,
  options: HumanInputEndpointOptions,
): Promise<ToolApproval | undefined> {
  const endpoint = requireEndpoint(options.endpoint, "decideApproval");
  const response = await requireFetch(options.fetch)(
    endpointUrl(endpoint, `approvals/${input.approvalId}/decision`),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        approved: input.approved,
        ...(input.reason === undefined ? {} : { reason: input.reason }),
      }),
    },
  );
  if (!response.ok) throw new Error(`Tool approval decision failed with status ${response.status}`);
  return responseJson<ToolApproval>(response);
}

export async function defaultAnswerQuestion(
  input: ToolQuestionAnswerInput,
  options: HumanInputEndpointOptions,
): Promise<ToolQuestion | undefined> {
  const endpoint = requireEndpoint(options.endpoint, "answerQuestion");
  const response = await requireFetch(options.fetch)(
    endpointUrl(endpoint, `questions/${input.questionId}/answer`),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ answers: input.answers }),
    },
  );
  if (!response.ok) throw new Error(`Tool question answer failed with status ${response.status}`);
  return responseJson<ToolQuestion>(response);
}

export function upsertById<TItem extends { id: string }>(items: TItem[], item: TItem): TItem[] {
  const index = items.findIndex((current) => current.id === item.id);
  if (index === -1) return [...items, item];
  const next = [...items];
  next[index] = item;
  return next;
}

function requireEndpoint(
  endpoint: string | URL | undefined,
  operation: "decideApproval" | "answerQuestion",
): string | URL {
  if (endpoint === undefined) {
    throw new Error(`humanInput.${operation} requires endpoint or a custom handler`);
  }
  return endpoint;
}

function requireFetch(fetchImpl: typeof fetch | undefined): typeof fetch {
  const resolved = fetchImpl ?? globalThis.fetch;
  if (resolved === undefined)
    throw new Error("Human input actions require a fetch implementation.");
  return resolved;
}

function endpointUrl(endpoint: string | URL, path: string): string | URL {
  const suffix = path.replace(/^\/+/, "");
  if (endpoint instanceof URL || /^[a-z][a-z\d+\-.]*:\/\//i.test(endpoint)) {
    const url = new URL(endpoint.toString());
    url.pathname = joinPath(url.pathname, suffix);
    return endpoint instanceof URL ? url : url.toString();
  }
  return joinPath(endpoint, suffix);
}

function joinPath(base: string, suffix: string): string {
  const prefix = base.replace(/\/+$/, "");
  return `${prefix.length === 0 ? "" : prefix}/${suffix.replace(/^\/+/, "")}`;
}

async function responseJson<T>(response: Response): Promise<T | undefined> {
  const text = await response.text();
  return text.trim().length === 0 ? undefined : (JSON.parse(text) as T);
}
