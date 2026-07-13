import type {
  ToolApproval,
  ToolApprovalDecisionInput,
  ToolQuestion,
  ToolQuestionAnswerInput,
} from "./types";

type HumanInputEndpointOptions = {
  endpoint?: string | URL;
  fetch?: typeof fetch;
};

export function defaultEventToApproval<TEvent>(event: TEvent): ToolApproval | undefined {
  if (!isRecord(event)) {
    return undefined;
  }
  if (event.type !== "tool_approval_request" && event.type !== "tool_approval_result") {
    return undefined;
  }
  return isToolApproval(event.approval) ? event.approval : undefined;
}

export function defaultEventToQuestion<TEvent>(event: TEvent): ToolQuestion | undefined {
  if (!isRecord(event)) {
    return undefined;
  }
  if (event.type !== "tool_question_request" && event.type !== "tool_question_result") {
    return undefined;
  }
  return isToolQuestion(event.question) ? event.question : undefined;
}

export async function defaultDecideApproval(
  input: ToolApprovalDecisionInput,
  options: HumanInputEndpointOptions,
): Promise<ToolApproval | undefined> {
  const endpoint = requireEndpoint(options.endpoint, "decideApproval");
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (fetchImpl === undefined) {
    throw new Error("humanInput approval decisions require a fetch implementation");
  }
  const body: { approved: boolean; reason?: string | undefined } = {
    approved: input.approved,
  };
  if (input.reason !== undefined) body.reason = input.reason;

  const response = await fetchImpl(
    endpointUrl(endpoint, `approvals/${input.approvalId}/decision`),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    throw new Error(`Tool approval decision failed with status ${response.status}`);
  }
  return responseJson<ToolApproval>(response);
}

export async function defaultAnswerQuestion(
  input: ToolQuestionAnswerInput,
  options: HumanInputEndpointOptions,
): Promise<ToolQuestion | undefined> {
  const endpoint = requireEndpoint(options.endpoint, "answerQuestion");
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (fetchImpl === undefined) {
    throw new Error("humanInput question answers require a fetch implementation");
  }

  const response = await fetchImpl(endpointUrl(endpoint, `questions/${input.questionId}/answer`), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ answers: input.answers }),
  });
  if (!response.ok) {
    throw new Error(`Tool question answer failed with status ${response.status}`);
  }
  return responseJson<ToolQuestion>(response);
}

export function upsertById<TItem extends { id: string }>(items: TItem[], item: TItem): TItem[] {
  const index = items.findIndex((current) => current.id === item.id);
  if (index === -1) {
    return [...items, item];
  }
  const next = [...items];
  next[index] = item;
  return next;
}

function requireEndpoint(
  endpoint: HumanInputEndpointOptions["endpoint"],
  operation: "decideApproval" | "answerQuestion",
): string | URL {
  if (endpoint === undefined) {
    throw new Error(`humanInput.${operation} requires endpoint or a custom handler`);
  }
  return endpoint;
}

function endpointUrl(endpoint: string | URL, path: string): string | URL {
  const suffix = path.replace(/^\/+/, "");
  if (endpoint instanceof URL) {
    const url = new URL(endpoint.toString());
    url.pathname = joinPath(url.pathname, suffix);
    return url;
  }
  if (/^[a-z][a-z\d+\-.]*:\/\//i.test(endpoint)) {
    const url = new URL(endpoint);
    url.pathname = joinPath(url.pathname, suffix);
    return url.toString();
  }
  return joinPath(endpoint, suffix);
}

function joinPath(base: string, suffix: string): string {
  const trimmedBase = base.replace(/\/+$/, "");
  const trimmedSuffix = suffix.replace(/^\/+/, "");
  if (trimmedBase.length === 0) {
    return `/${trimmedSuffix}`;
  }
  return `${trimmedBase}/${trimmedSuffix}`;
}

async function responseJson<T>(response: Response): Promise<T | undefined> {
  const text = await response.text();
  if (text.trim().length === 0) {
    return undefined;
  }
  return JSON.parse(text) as T;
}

function isToolApproval(value: unknown): value is ToolApproval {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.toolName === "string" &&
    typeof value.status === "string"
  );
}

function isToolQuestion(value: unknown): value is ToolQuestion {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.toolName === "string" &&
    typeof value.status === "string" &&
    Array.isArray(value.questions)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
