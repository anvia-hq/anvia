import type {
  MemoryConversation,
  MemoryConversationListOptions,
  MemoryConversationSummary,
  MemoryInspector,
  MemoryStore,
} from "@anvia/core/memory";
import type { Hono } from "hono";
import type {
  StudioAgent,
  StudioMemoryConversationMessages,
  StudioMemoryConversationSteps,
  StudioMemoryConversationSummary,
  StudioMemoryConversationsPage,
  StudioMemoryMessageRecord,
  StudioMemorySourceConversationMessages,
  StudioMemorySourceConversationSteps,
  StudioMemorySourceConversationSummary,
  StudioMemorySourceConversationsPage,
  StudioMemorySourceSummary,
  StudioMemorySourcesPage,
  StudioMemorySourceUsersPage,
  StudioMemoryUsersPage,
  StudioSession,
  StudioSessionStore,
  StudioSessionSummary,
} from "../types";
import { errorResponse } from "./http";
import { optionalQueryString, parseLimit } from "./query";
import { transcriptFromMessages } from "./transcript";

const DEFAULT_USER_ID = "default";
const USER_DISCOVERY_LIMIT = 1_000;

type StudioMemorySourceDetail = {
  conversation: StudioMemorySourceConversationSummary;
  records: StudioMemoryMessageRecord[];
};

type StudioMemorySource = {
  summary: StudioMemorySourceSummary;
  listConversations(
    options: MemoryConversationListOptions,
  ): Promise<StudioMemorySourceConversationSummary[]>;
  getConversation(ref: string): Promise<StudioMemorySourceDetail | undefined>;
};

export type StudioMemorySourceRegistry = {
  readonly size: number;
  list(): StudioMemorySourceSummary[];
  get(ref: string): StudioMemorySource | undefined;
};

export function createStudioMemorySourceRegistry(
  agents: StudioAgent[],
  sessionStore: StudioSessionStore | undefined,
): StudioMemorySourceRegistry {
  const sources: StudioMemorySource[] = [];
  const byStore = new Map<MemoryStore, StudioMemorySource>();
  const agentsWithoutMemory: StudioAgent[] = [];

  for (const agent of agents) {
    const store = agent.agent.memory?.store;
    if (store === undefined) {
      agentsWithoutMemory.push(agent);
      continue;
    }

    const existing = byStore.get(store);
    if (existing !== undefined) {
      existing.summary.agentIds.push(agent.id);
      existing.summary.label = "Shared agent memory";
      continue;
    }

    const ref = `agent-memory-${sources.length + 1}`;
    const label = `${agent.name ?? agent.agent.name ?? agent.id} memory`;
    const kind = storeKind(store);
    const source =
      store.inspector === undefined
        ? unavailableAgentSource(ref, label, agent.id, kind)
        : agentMemorySource(ref, label, agent.id, kind, store.inspector);
    sources.push(source);
    byStore.set(store, source);
  }

  if (sessionStore !== undefined && (agentsWithoutMemory.length > 0 || agents.length === 0)) {
    sources.push(
      studioSessionSource(
        sessionStore,
        agentsWithoutMemory.map((agent) => agent.id),
      ),
    );
  }

  const byRef = new Map(sources.map((source) => [source.summary.ref, source]));
  return {
    size: sources.length,
    list: () =>
      sources.map((source) => ({ ...source.summary, agentIds: [...source.summary.agentIds] })),
    get: (ref) => byRef.get(ref),
  };
}

export function registerMemoryRoutes(
  app: Hono,
  props: {
    sources: StudioMemorySourceRegistry;
    sessionStore?: StudioSessionStore | undefined;
  },
): void {
  registerMemorySourceRoutes(app, props.sources);
  if (props.sessionStore !== undefined) {
    registerLegacyMemoryRoutes(app, props.sessionStore);
  }
}

function registerMemorySourceRoutes(app: Hono, registry: StudioMemorySourceRegistry): void {
  app.get("/memory/sources", (c) =>
    c.json({ sources: registry.list() } satisfies StudioMemorySourcesPage),
  );

  app.get("/memory/sources/:sourceRef/users", async (c) => {
    const limit = parseLimit(c.req.query("limit"));
    if (limit === undefined) {
      return errorResponse(c, 400, "bad_request", "limit must be a positive integer");
    }
    const source = registry.get(c.req.param("sourceRef"));
    if (source === undefined) {
      return errorResponse(c, 404, "not_found", "Memory source not found");
    }
    if (!source.summary.available) return unavailableSourceResponse(c, source.summary);

    const conversations = await source.listConversations({ limit: USER_DISCOVERY_LIMIT });
    const userPage = memoryUsers(conversations, limit);
    return c.json({
      source: source.summary,
      users: userPage.users,
      total: userPage.total,
    } satisfies StudioMemorySourceUsersPage);
  });

  app.get("/memory/sources/:sourceRef/conversations", async (c) => {
    const limit = parseLimit(c.req.query("limit"));
    if (limit === undefined) {
      return errorResponse(c, 400, "bad_request", "limit must be a positive integer");
    }
    const source = registry.get(c.req.param("sourceRef"));
    if (source === undefined) {
      return errorResponse(c, 404, "not_found", "Memory source not found");
    }
    if (!source.summary.available) return unavailableSourceResponse(c, source.summary);

    const userId = optionalQueryString(c.req.query("userId"));
    const listOptions: MemoryConversationListOptions = { limit };
    if (userId !== undefined) listOptions.userId = userId;
    const conversations = await source.listConversations(listOptions);
    return c.json({
      source: source.summary,
      conversations,
      total: conversations.length,
    } satisfies StudioMemorySourceConversationsPage);
  });

  app.get("/memory/sources/:sourceRef/conversations/:conversationRef/messages", async (c) => {
    const source = registry.get(c.req.param("sourceRef"));
    if (source === undefined) {
      return errorResponse(c, 404, "not_found", "Memory source not found");
    }
    if (!source.summary.available) return unavailableSourceResponse(c, source.summary);

    const detail = await source.getConversation(c.req.param("conversationRef"));
    if (detail === undefined) {
      return errorResponse(c, 404, "not_found", "Conversation not found");
    }
    const messages = detail.records.map((record) => record.message);
    return c.json({
      source: source.summary,
      conversation: detail.conversation,
      messages,
      records: detail.records,
      transcript: transcriptFromMessages(messages),
    } satisfies StudioMemorySourceConversationMessages);
  });

  app.get("/memory/sources/:sourceRef/conversations/:conversationRef/steps", async (c) => {
    const source = registry.get(c.req.param("sourceRef"));
    if (source === undefined) {
      return errorResponse(c, 404, "not_found", "Memory source not found");
    }
    if (!source.summary.available) return unavailableSourceResponse(c, source.summary);

    const detail = await source.getConversation(c.req.param("conversationRef"));
    if (detail === undefined) {
      return errorResponse(c, 404, "not_found", "Conversation not found");
    }
    return c.json({
      source: source.summary,
      conversation: detail.conversation,
      steps: transcriptFromMessages(detail.records.map((record) => record.message)),
    } satisfies StudioMemorySourceConversationSteps);
  });
}

function registerLegacyMemoryRoutes(app: Hono, sessionStore: StudioSessionStore): void {
  app.get("/memory/users", async (c) => {
    const limit = parseLimit(c.req.query("limit"));
    if (limit === undefined) {
      return errorResponse(c, 400, "bad_request", "limit must be a positive integer");
    }

    const sessions = await sessionStore.listSessions({ limit: 100 });
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
      if (!existing.agentIds.includes(session.agentId)) existing.agentIds.push(session.agentId);
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
    const listInput: Parameters<typeof sessionStore.listSessions>[0] = { limit: 100 };
    if (agentId !== undefined) listInput.agentId = agentId;
    const sessions = await sessionStore.listSessions(listInput);
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
    const session = await sessionStore.getSession(c.req.param("conversationId"));
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
    const session = await sessionStore.getSession(c.req.param("conversationId"));
    if (session === undefined) {
      return errorResponse(c, 404, "not_found", "Conversation not found");
    }
    return c.json({
      conversation: memoryConversationSummary(session),
      steps: session.transcript,
    } satisfies StudioMemoryConversationSteps);
  });
}

function agentMemorySource(
  ref: string,
  label: string,
  agentId: string,
  storeKindValue: string | undefined,
  inspector: MemoryInspector,
): StudioMemorySource {
  const summary: StudioMemorySourceSummary = {
    ref,
    kind: "agent",
    label,
    agentIds: [agentId],
    available: true,
  };
  if (storeKindValue !== undefined) summary.storeKind = storeKindValue;

  return {
    summary,
    async listConversations(options) {
      const inspectorOptions: MemoryConversationListOptions = {
        limit: options.userId === DEFAULT_USER_ID ? USER_DISCOVERY_LIMIT : options.limit,
      };
      if (options.userId !== undefined && options.userId !== DEFAULT_USER_ID) {
        inspectorOptions.userId = options.userId;
      }
      const conversations = await inspector.listConversations(inspectorOptions);
      return conversations
        .map((conversation) => sourceConversationSummary(conversation, summary.agentIds))
        .filter(
          (conversation) => options.userId === undefined || conversation.userId === options.userId,
        )
        .slice(0, options.limit);
    },
    async getConversation(conversationRef) {
      const conversation = await inspector.getConversation(conversationRef);
      return conversation === undefined
        ? undefined
        : inspectorConversationDetail(conversation, summary.agentIds);
    },
  };
}

function unavailableAgentSource(
  ref: string,
  label: string,
  agentId: string,
  storeKindValue: string | undefined,
): StudioMemorySource {
  const summary: StudioMemorySourceSummary = {
    ref,
    kind: "agent",
    label,
    agentIds: [agentId],
    available: false,
    reason: "This memory store does not expose the optional inspector capability.",
  };
  if (storeKindValue !== undefined) summary.storeKind = storeKindValue;
  return {
    summary,
    listConversations: async () => [],
    getConversation: async () => undefined,
  };
}

function studioSessionSource(
  sessionStore: StudioSessionStore,
  agentIds: string[],
): StudioMemorySource {
  const summary: StudioMemorySourceSummary = {
    ref: "studio-sessions",
    kind: "studio",
    label: "Studio sessions",
    agentIds: [...agentIds],
    available: true,
    storeKind: sessionStore.kind ?? "studio",
  };
  const allowedAgents = new Set(agentIds);
  const restrictAgents = allowedAgents.size > 0;

  return {
    summary,
    async listConversations(options) {
      const sessions = await sessionStore.listSessions({ limit: USER_DISCOVERY_LIMIT });
      return sessions
        .filter((session) => !restrictAgents || allowedAgents.has(session.agentId))
        .map(studioSourceConversationSummary)
        .filter(
          (conversation) => options.userId === undefined || conversation.userId === options.userId,
        )
        .slice(0, options.limit);
    },
    async getConversation(conversationRef) {
      const session = await sessionStore.getSession(conversationRef);
      if (session === undefined || (restrictAgents && !allowedAgents.has(session.agentId))) {
        return undefined;
      }
      return {
        conversation: studioSourceConversationSummary(session),
        records: session.messages.map((message, position) => ({
          position,
          runId: "studio-session",
          turn: 0,
          createdAt: session.updatedAt,
          message,
        })),
      };
    },
  };
}

function sourceConversationSummary(
  conversation: MemoryConversationSummary,
  agentIds: string[],
): StudioMemorySourceConversationSummary {
  const summary: StudioMemorySourceConversationSummary = {
    ref: conversation.ref,
    sessionId: conversation.sessionId,
    userId: conversation.userId ?? DEFAULT_USER_ID,
    agentIds: [...agentIds],
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    messageCount: conversation.messageCount,
  };
  if (conversation.metadata !== undefined) summary.metadata = conversation.metadata;
  return summary;
}

function inspectorConversationDetail(
  conversation: MemoryConversation,
  agentIds: string[],
): StudioMemorySourceDetail {
  return {
    conversation: sourceConversationSummary(conversation, agentIds),
    records: conversation.messages,
  };
}

function studioSourceConversationSummary(
  session: StudioSession | StudioSessionSummary,
): StudioMemorySourceConversationSummary {
  const summary: StudioMemorySourceConversationSummary = {
    ref: session.id,
    sessionId: session.id,
    userId: sessionUserId(session),
    agentIds: [session.agentId],
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messageCount: session.messageCount,
  };
  if (session.title !== undefined) summary.title = session.title;
  if (session.metadata !== undefined) summary.metadata = session.metadata;
  return summary;
}

function memoryUsers(
  conversations: StudioMemorySourceConversationSummary[],
  limit: number,
): { users: StudioMemoryUsersPage["users"]; total: number } {
  const users = new Map<string, StudioMemoryUsersPage["users"][number]>();
  for (const conversation of conversations) {
    const existing = users.get(conversation.userId);
    if (existing === undefined) {
      users.set(conversation.userId, {
        userId: conversation.userId,
        conversationCount: 1,
        agentIds: [...conversation.agentIds],
        lastInteractionAt: conversation.updatedAt,
      });
      continue;
    }
    existing.conversationCount += 1;
    for (const agentId of conversation.agentIds) {
      if (!existing.agentIds.includes(agentId)) existing.agentIds.push(agentId);
    }
    if (
      new Date(conversation.updatedAt).getTime() > new Date(existing.lastInteractionAt).getTime()
    ) {
      existing.lastInteractionAt = conversation.updatedAt;
    }
  }
  return {
    users: [...users.values()]
      .sort(
        (left, right) =>
          new Date(right.lastInteractionAt).getTime() - new Date(left.lastInteractionAt).getTime(),
      )
      .slice(0, limit),
    total: users.size,
  };
}

function memoryConversationSummary(
  session: StudioSession | StudioSessionSummary,
): StudioMemoryConversationSummary {
  const summary: StudioMemoryConversationSummary = {
    id: session.id,
    userId: sessionUserId(session),
    agentId: session.agentId,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messageCount: session.messageCount,
  };
  if (session.title !== undefined) summary.title = session.title;
  if (session.metadata !== undefined) summary.metadata = session.metadata;
  return summary;
}

function sessionUserId(session: Pick<StudioSession, "metadata">): string {
  const userId = session.metadata?.userId;
  return typeof userId === "string" && userId.trim().length > 0 ? userId : DEFAULT_USER_ID;
}

function storeKind(store: MemoryStore): string | undefined {
  const kind = (store as MemoryStore & { readonly kind?: unknown }).kind;
  return typeof kind === "string" && kind.length > 0 ? kind : undefined;
}

function unavailableSourceResponse(
  c: Parameters<typeof errorResponse>[0],
  source: StudioMemorySourceSummary,
): Response {
  return errorResponse(
    c,
    501,
    "unsupported_capability",
    source.reason ?? "Memory source is not inspectable",
    { sourceRef: source.ref },
  );
}
