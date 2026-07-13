import type { JsonObject } from "@anvia/core/completion";
import type { ToolApprovalRequest, ToolApprovalsOptions } from "@anvia/core/tool";
import type { Context, Hono } from "hono";
import type {
  AgentRunStreamEvent,
  StudioToolApproval,
  StudioToolApprovalDecision,
  StudioToolApprovalStatus,
} from "../types";
import { errorResponse } from "./http";
import { optionalQueryString } from "./query";
import { isObject } from "./type-guards";

type PendingApproval = StudioToolApproval & {
  status: "pending";
  rejectMessage?: string;
  emit?: (event: AgentRunStreamEvent) => void;
  resolve: (decision: StudioToolApprovalDecision) => void;
};

type ApprovalHookContext = {
  runId: string;
  agentId: string;
  sessionId?: string;
  metadata?: JsonObject;
  emit?: (event: AgentRunStreamEvent) => void;
};

type ApprovalRequest = {
  toolName: string;
  toolCallId?: string;
  internalCallId: string;
  args: string;
  reason?: string;
  rejectMessage?: string;
};

export type ApprovalRuntime = {
  approvals: Map<string, PendingApproval | StudioToolApproval>;
  createApprovals(context: ApprovalHookContext): ToolApprovalsOptions;
  list(options: ApprovalListOptions): StudioToolApproval[];
  decide(
    id: string,
    decision: StudioToolApprovalDecision,
  ): "missing" | "resolved" | StudioToolApproval;
};

type ApprovalListOptions = {
  status?: "pending" | "resolved";
  runId?: string;
  agentId?: string;
  sessionId?: string;
};

export function registerApprovalRoutes(app: Hono, approvals: ApprovalRuntime): void {
  app.get("/approvals", (c) => {
    const status = parseApprovalStatus(c.req.query("status"));
    if (status === false) {
      return errorResponse(c, 400, "bad_request", "status must be pending or resolved");
    }

    const options: ApprovalListOptions = {};
    const runId = optionalQueryString(c.req.query("runId"));
    const agentId = optionalQueryString(c.req.query("agentId"));
    const sessionId = optionalQueryString(c.req.query("sessionId"));
    if (status !== undefined) {
      options.status = status;
    }
    if (runId !== undefined) {
      options.runId = runId;
    }
    if (agentId !== undefined) {
      options.agentId = agentId;
    }
    if (sessionId !== undefined) {
      options.sessionId = sessionId;
    }

    return c.json({
      approvals: approvals.list(options),
    });
  });

  app.post("/approvals/:approvalId/decision", async (c) => {
    const body = await parseApprovalDecisionRequest(c);
    if ("error" in body) {
      return body.error;
    }

    const result = approvals.decide(c.req.param("approvalId"), body);
    if (result === "missing") {
      return errorResponse(c, 404, "not_found", "Approval not found");
    }
    if (result === "resolved") {
      return errorResponse(c, 409, "conflict", "Approval is already resolved");
    }
    return c.json(result);
  });
}

function parseApprovalStatus(
  value: string | undefined,
): "pending" | "resolved" | undefined | false {
  const status = optionalQueryString(value);
  if (status === undefined) {
    return undefined;
  }
  return status === "pending" || status === "resolved" ? status : false;
}

async function parseApprovalDecisionRequest(
  c: Context,
): Promise<StudioToolApprovalDecision | { error: Response }> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return { error: errorResponse(c, 400, "bad_request", "Request body must be JSON") };
  }

  if (!isObject(body)) {
    return { error: errorResponse(c, 400, "bad_request", "Request body must be an object") };
  }
  if (typeof body.approved !== "boolean") {
    return { error: errorResponse(c, 400, "bad_request", "approved must be a boolean") };
  }
  if ("reason" in body && typeof body.reason !== "string") {
    return { error: errorResponse(c, 400, "bad_request", "reason must be a string") };
  }

  const reason =
    typeof body.reason === "string" && body.reason.trim().length > 0
      ? body.reason.trim()
      : undefined;
  return approvalDecision(body.approved, reason);
}

export function createApprovalRuntime(): ApprovalRuntime {
  const approvals = new Map<string, PendingApproval | StudioToolApproval>();

  return {
    approvals,
    createApprovals(context) {
      return {
        async handler(request: ToolApprovalRequest) {
          const approvalRequest: ApprovalRequest = {
            toolName: request.toolName,
            internalCallId: request.internalCallId,
            args: request.rawArgs,
          };
          if (request.toolCallId !== undefined) approvalRequest.toolCallId = request.toolCallId;
          if (request.reason !== undefined) approvalRequest.reason = request.reason;
          if (request.rejectMessage !== undefined) {
            approvalRequest.rejectMessage = request.rejectMessage;
          }
          const decision = await requestApproval(approvals, context, approvalRequest);
          return approvalDecision(decision.approved, decision.reason);
        },
      };
    },
    list(options) {
      return [...approvals.values()]
        .filter((approval) => {
          if (options.status === "pending" && approval.status !== "pending") {
            return false;
          }
          if (options.status === "resolved" && approval.status === "pending") {
            return false;
          }
          if (options.runId !== undefined && approval.runId !== options.runId) {
            return false;
          }
          if (options.agentId !== undefined && approval.agentId !== options.agentId) {
            return false;
          }
          if (options.sessionId !== undefined && approval.sessionId !== options.sessionId) {
            return false;
          }
          return true;
        })
        .map(publicApproval);
    },
    decide(id, decision) {
      const approval = approvals.get(id);
      if (approval === undefined) {
        return "missing";
      }
      if (!isPendingApproval(approval)) {
        return "resolved";
      }

      const reason = decision.approved
        ? decision.reason
        : (decision.reason ?? approval.rejectMessage ?? "Rejected in Anvia Studio.");
      const resolved = resolveApproval(
        approval,
        decision.approved ? "approved" : "rejected",
        reason === undefined ? {} : { reason },
      );
      approvals.set(id, resolved);
      approval.emit?.({ type: "tool_approval_result", approval: resolved });
      approval.resolve(approvalDecision(decision.approved, reason));
      return publicApproval(resolved);
    },
  };
}

async function requestApproval(
  approvals: Map<string, PendingApproval | StudioToolApproval>,
  context: ApprovalHookContext,
  request: ApprovalRequest,
): Promise<StudioToolApprovalDecision> {
  const id = globalThis.crypto.randomUUID();
  const approval: PendingApproval = {
    id,
    runId: context.runId,
    agentId: context.agentId,
    toolName: request.toolName,
    internalCallId: request.internalCallId,
    args: request.args,
    status: "pending",
    requestedAt: new Date().toISOString(),
    resolve: () => {},
  };
  if (context.sessionId !== undefined) approval.sessionId = context.sessionId;
  if (request.toolCallId !== undefined) approval.callId = request.toolCallId;
  if (request.reason !== undefined) approval.reason = request.reason;
  if (request.rejectMessage !== undefined) approval.rejectMessage = request.rejectMessage;
  if (context.emit !== undefined) approval.emit = context.emit;

  const decision = new Promise<StudioToolApprovalDecision>((resolve) => {
    approval.resolve = (decision) => {
      const current = approvals.get(id);
      if (!isPendingApproval(current)) {
        if (current !== undefined) {
          resolve(approvalDecision(current.status === "approved", current.reason));
        }
        return;
      }
      const reason = decision.approved
        ? decision.reason
        : (decision.reason ?? request.rejectMessage ?? "Rejected in Anvia Studio.");
      const resolved = resolveApproval(
        current,
        decision.approved ? "approved" : "rejected",
        reason === undefined ? {} : { reason },
      );
      approvals.set(id, resolved);
      context.emit?.({ type: "tool_approval_result", approval: resolved });
      resolve(approvalDecision(decision.approved, reason));
    };
  });

  approvals.set(id, approval);
  context.emit?.({ type: "tool_approval_request", approval: publicApproval(approval) });
  return decision;
}

function isPendingApproval(
  approval: PendingApproval | StudioToolApproval | undefined,
): approval is PendingApproval {
  return approval !== undefined && approval.status === "pending" && "resolve" in approval;
}

function resolveApproval(
  approval: PendingApproval | StudioToolApproval,
  status: Exclude<StudioToolApprovalStatus, "pending">,
  options: { reason?: string } = {},
): StudioToolApproval {
  const resolved: PendingApproval | StudioToolApproval = {
    ...approval,
    status,
    resolvedAt: new Date().toISOString(),
  };
  if (options.reason !== undefined) resolved.reason = options.reason;
  return publicApproval(resolved);
}

function approvalDecision(
  approved: boolean,
  reason: string | undefined,
): StudioToolApprovalDecision {
  const decision: StudioToolApprovalDecision = { approved };
  if (reason !== undefined) decision.reason = reason;
  return decision;
}

function publicApproval(approval: PendingApproval | StudioToolApproval): StudioToolApproval {
  const { emit, rejectMessage, resolve, ...rest } = approval as PendingApproval;
  void emit;
  void rejectMessage;
  void resolve;
  return rest;
}
