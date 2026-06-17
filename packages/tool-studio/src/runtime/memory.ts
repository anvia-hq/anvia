import type { Hono } from "hono";
import type {
  StudioMemoryConversationMessages,
  StudioMemoryConversationSteps,
  StudioMemoryConversationSummary,
  StudioMemoryConversationsPage,
  StudioMemoryUsersPage,
  StudioSession,
  StudioSessionStore,
  StudioSessionSummary,
} from "../types";
import { compact } from "./compact";
import { errorResponse } from "./http";
import { optionalQueryString, parseLimit } from "./query";

const DEFAULT_USER_ID = "default";

export function registerMemoryRoutes(
  app: Hono,
  props: {
    sessionStore: StudioSessionStore;
  },
): void {
  app.get("/memory/users", async (c) => {
    const limit = parseLimit(c.req.query("limit"));
    if (limit === undefined) {
      return errorResponse(c, 400, "bad_request", "limit must be a positive integer");
    }

    const sessions = await props.sessionStore.listSessions({ limit: 100 });
    const users = new Map<string, StudioMemoryUsersPage["users"][number]>();
    for (const session of sessions) {
      const userId = sessionUserId(session);
      const existing = users.get(userId);
      if (existing === undefined) {
        users.set(userId, {
          userId,
          conversationCount: 1,
          agentIds: [session.agentId],
          lastInteractionAt: session.updatedAt,
        });
        continue;
      }
      existing.conversationCount += 1;
      if (!existing.agentIds.includes(session.agentId)) {
        existing.agentIds.push(session.agentId);
      }
      if (new Date(session.updatedAt).getTime() > new Date(existing.lastInteractionAt).getTime()) {
        existing.lastInteractionAt = session.updatedAt;
      }
    }

    const page = [...users.values()]
      .sort(
        (left, right) =>
          new Date(right.lastInteractionAt).getTime() - new Date(left.lastInteractionAt).getTime(),
      )
      .slice(0, limit);
    return c.json({ users: page, total: users.size } satisfies StudioMemoryUsersPage);
  });

  app.get("/memory/conversations", async (c) => {
    const limit = parseLimit(c.req.query("limit"));
    if (limit === undefined) {
      return errorResponse(c, 400, "bad_request", "limit must be a positive integer");
    }

    const agentId = optionalQueryString(c.req.query("agentId"));
    const userId = optionalQueryString(c.req.query("userId"));
    const sessions = await props.sessionStore.listSessions({
      ...compact({ agentId }),
      limit: 100,
    });
    const conversations = sessions
      .map(memoryConversationSummary)
      .filter((session) => userId === undefined || session.userId === userId)
      .slice(0, limit);

    return c.json({
      conversations,
      total: conversations.length,
    } satisfies StudioMemoryConversationsPage);
  });

  app.get("/memory/conversations/:conversationId/messages", async (c) => {
    const session = await props.sessionStore.getSession(c.req.param("conversationId"));
    if (session === undefined) {
      return errorResponse(c, 404, "not_found", "Conversation not found");
    }
    return c.json({
      conversation: memoryConversationSummary(session),
      messages: session.messages,
      transcript: session.transcript,
    } satisfies StudioMemoryConversationMessages);
  });

  app.get("/memory/conversations/:conversationId/steps", async (c) => {
    const session = await props.sessionStore.getSession(c.req.param("conversationId"));
    if (session === undefined) {
      return errorResponse(c, 404, "not_found", "Conversation not found");
    }
    return c.json({
      conversation: memoryConversationSummary(session),
      steps: session.transcript,
    } satisfies StudioMemoryConversationSteps);
  });
}

function memoryConversationSummary(
  session: StudioSession | StudioSessionSummary,
): StudioMemoryConversationSummary {
  return compact({
    id: session.id,
    userId: sessionUserId(session),
    agentId: session.agentId,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messageCount: session.messageCount,
    metadata: session.metadata,
  }) as StudioMemoryConversationSummary;
}

function sessionUserId(session: Pick<StudioSession, "metadata">): string {
  const userId = session.metadata?.userId;
  return typeof userId === "string" && userId.trim().length > 0 ? userId : DEFAULT_USER_ID;
}
