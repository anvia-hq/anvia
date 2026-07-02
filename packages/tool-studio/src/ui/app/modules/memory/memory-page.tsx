import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  StudioConfig,
  StudioMemoryConversationMessages,
  StudioMemoryConversationSteps,
  StudioMemoryConversationSummary,
  StudioMemoryConversationsPage,
  StudioMemoryUsersPage,
} from "../../../../types";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { formatRelativeTime } from "../shared/format";
import { JsonSyntax } from "../shared/renderers";

export function MemoryPage(props: { agents: StudioConfig["agents"]; enabled: boolean }) {
  const [users, setUsers] = useState<StudioMemoryUsersPage["users"]>([]);
  const [conversations, setConversations] = useState<StudioMemoryConversationSummary[]>([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedConversationId, setSelectedConversationId] = useState("");
  const [messages, setMessages] = useState<StudioMemoryConversationMessages | undefined>();
  const [steps, setSteps] = useState<StudioMemoryConversationSteps | undefined>();
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");

  const loadMemory = useCallback(async () => {
    if (!props.enabled) {
      setUsers([]);
      setConversations([]);
      setMessages(undefined);
      setSteps(undefined);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const [usersResponse, conversationsResponse] = await Promise.all([
        fetch("/memory/users?limit=50"),
        fetch("/memory/conversations?limit=100"),
      ]);
      if (!usersResponse.ok) {
        throw new Error(`Memory users failed with HTTP ${usersResponse.status}`);
      }
      if (!conversationsResponse.ok) {
        throw new Error(`Memory conversations failed with HTTP ${conversationsResponse.status}`);
      }
      const usersBody = (await usersResponse.json()) as StudioMemoryUsersPage;
      const conversationsBody =
        (await conversationsResponse.json()) as StudioMemoryConversationsPage;
      setUsers(usersBody.users);
      setConversations(conversationsBody.conversations);
      setSelectedConversationId(
        (current) => current || conversationsBody.conversations[0]?.id || "",
      );
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, [props.enabled]);

  useEffect(() => {
    void loadMemory();
  }, [loadMemory]);

  useEffect(() => {
    if (!props.enabled || selectedConversationId.length === 0) {
      setMessages(undefined);
      setSteps(undefined);
      return;
    }
    let cancelled = false;
    async function loadDetail() {
      setDetailLoading(true);
      setError("");
      try {
        const [messagesResponse, stepsResponse] = await Promise.all([
          fetch(`/memory/conversations/${encodeURIComponent(selectedConversationId)}/messages`),
          fetch(`/memory/conversations/${encodeURIComponent(selectedConversationId)}/steps`),
        ]);
        if (!messagesResponse.ok) {
          throw new Error(`Conversation messages failed with HTTP ${messagesResponse.status}`);
        }
        if (!stepsResponse.ok) {
          throw new Error(`Conversation steps failed with HTTP ${stepsResponse.status}`);
        }
        if (!cancelled) {
          setMessages((await messagesResponse.json()) as StudioMemoryConversationMessages);
          setSteps((await stepsResponse.json()) as StudioMemoryConversationSteps);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : String(loadError));
          setMessages(undefined);
          setSteps(undefined);
        }
      } finally {
        if (!cancelled) {
          setDetailLoading(false);
        }
      }
    }
    void loadDetail();
    return () => {
      cancelled = true;
    };
  }, [props.enabled, selectedConversationId]);

  const visibleConversations = useMemo(
    () =>
      selectedUserId.length === 0
        ? conversations
        : conversations.filter((conversation) => conversation.userId === selectedUserId),
    [conversations, selectedUserId],
  );
  const totals = useMemo(() => memoryTotals(users, conversations), [conversations, users]);
  const selectedConversation =
    visibleConversations.find((conversation) => conversation.id === selectedConversationId) ??
    visibleConversations[0];

  useEffect(() => {
    if (visibleConversations.length === 0) {
      setSelectedConversationId("");
      return;
    }
    if (!visibleConversations.some((conversation) => conversation.id === selectedConversationId)) {
      setSelectedConversationId(visibleConversations[0]?.id ?? "");
    }
  }, [selectedConversationId, visibleConversations]);

  return (
    <section
      className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-background/55"
      aria-label="Memory"
    >
      <header className="bg-background/70 pb-3 pl-4 pr-6 pt-4 backdrop-blur">
        <div className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-end gap-4 max-md:grid-cols-1">
          <div className="grid min-w-0 gap-2">
            <div className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
              Conversation store
            </div>
            <h1 className="m-0 text-2xl font-semibold leading-none tracking-tight text-foreground">
              Memory
            </h1>
            <p className="m-0 max-w-[62ch] text-sm leading-6 text-muted-foreground">
              Stored users, conversations, raw messages, and transcript steps from the Studio store.
            </p>
          </div>
          <div className="flex min-w-0 flex-wrap justify-end gap-2 max-md:justify-start">
            <MemoryMetric label="users" value={totals.userCount} />
            <MemoryMetric label="conversations" value={totals.conversationCount} />
            <MemoryMetric label="messages" value={totals.messageCount} />
            <Button
              className="h-8 min-h-8 rounded-md px-3 text-xs"
              type="button"
              variant="secondary"
              disabled={loading}
              onClick={() => void loadMemory()}
            >
              Refresh
            </Button>
          </div>
        </div>
      </header>

      <div className="min-h-0 overflow-hidden pb-6 pl-4 pr-6">
        {!props.enabled ? (
          <EmptyState title="Memory unavailable" text="This Studio runtime has no session store." />
        ) : loading && conversations.length === 0 ? (
          <EmptyState title="Loading memory" text="Reading users and conversations." />
        ) : error.length > 0 && conversations.length === 0 ? (
          <EmptyState title="Memory error" text={error} />
        ) : conversations.length === 0 ? (
          <MemoryEmptyDashboard
            agentCount={props.agents.length}
            userCount={users.length}
            onRefresh={() => void loadMemory()}
          />
        ) : (
          <div
            className={[
              "grid h-full min-h-0 overflow-hidden",
              error.length === 0 ? "grid-rows-[minmax(0,1fr)]" : "grid-rows-[auto_minmax(0,1fr)]",
            ].join(" ")}
          >
            {error.length === 0 ? null : <InlineError message={error} />}
            <div className="grid min-h-0 grid-cols-[260px_minmax(320px,0.78fr)_minmax(0,1.22fr)] overflow-hidden border-t border-border/80 max-xl:grid-cols-[240px_minmax(0,1fr)] max-xl:grid-rows-[minmax(240px,0.42fr)_minmax(0,1fr)] max-md:grid-cols-1 max-md:grid-rows-[auto_minmax(240px,0.38fr)_minmax(0,1fr)]">
              <MemoryUserRail
                users={users}
                selectedUserId={selectedUserId}
                totalConversations={conversations.length}
                onSelect={setSelectedUserId}
              />
              <ConversationLedger
                agents={props.agents}
                conversations={visibleConversations}
                selectedConversationId={selectedConversation?.id ?? ""}
                onSelect={setSelectedConversationId}
              />
              <ConversationDetail
                agents={props.agents}
                conversation={selectedConversation}
                detailLoading={detailLoading}
                messages={messages}
                steps={steps}
              />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function MemoryUserRail(props: {
  users: StudioMemoryUsersPage["users"];
  selectedUserId: string;
  totalConversations: number;
  onSelect: (userId: string) => void;
}) {
  return (
    <aside className="min-h-0 overflow-auto border-r border-border/80 pr-3 max-md:border-b max-md:border-r-0 max-md:pr-0">
      <div className="grid gap-3 py-4 pr-3 max-md:pr-0">
        <SectionLabel label="Users" value={props.users.length} />
        <UserFilterButton
          active={props.selectedUserId.length === 0}
          title="All users"
          detail={`${props.totalConversations} conversations`}
          onClick={() => props.onSelect("")}
        />
        <div className="grid gap-1">
          {props.users.map((user) => (
            <UserFilterButton
              active={props.selectedUserId === user.userId}
              title={user.userId}
              detail={`${user.conversationCount} conversations / ${formatRelativeTime(
                user.lastInteractionAt,
              )}`}
              key={user.userId}
              onClick={() => props.onSelect(user.userId)}
            />
          ))}
        </div>
      </div>
    </aside>
  );
}

function UserFilterButton(props: {
  active: boolean;
  title: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <button
      className={[
        "grid min-w-0 gap-1 rounded-lg border border-transparent px-3 py-2.5 text-left transition duration-200 hover:border-border/80 hover:bg-muted/25 focus-visible:border-ring focus-visible:outline-none",
        props.active ? "border-border/80 bg-muted/35" : "",
      ].join(" ")}
      type="button"
      onClick={props.onClick}
    >
      <span className="min-w-0 truncate text-sm font-semibold text-foreground">{props.title}</span>
      <span className="min-w-0 truncate text-xs leading-5 text-muted-foreground">
        {props.detail}
      </span>
    </button>
  );
}

function ConversationLedger(props: {
  agents: StudioConfig["agents"];
  conversations: StudioMemoryConversationSummary[];
  selectedConversationId: string;
  onSelect: (conversationId: string) => void;
}) {
  return (
    <section className="min-h-0 overflow-auto border-r border-border/80 px-4 max-xl:border-r-0 max-xl:pr-0 max-md:border-b max-md:px-0">
      <div className="grid gap-3 py-4">
        <SectionLabel label="Conversations" value={props.conversations.length} />
        {props.conversations.length === 0 ? (
          <div className="border-y border-dashed border-border/80 px-3 py-8 text-center text-sm text-muted-foreground">
            No conversations for this user.
          </div>
        ) : (
          <div className="grid border-y border-border/80">
            {props.conversations.map((conversation) => (
              <ConversationRow
                active={conversation.id === props.selectedConversationId}
                agentName={agentLabel(props.agents, conversation.agentId)}
                conversation={conversation}
                key={conversation.id}
                onSelect={() => props.onSelect(conversation.id)}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function ConversationRow(props: {
  conversation: StudioMemoryConversationSummary;
  agentName: string;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      className={[
        "grid min-w-0 gap-2 border-b border-border/70 px-3 py-3 text-left transition duration-200 last:border-b-0 hover:bg-muted/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        props.active ? "bg-muted/35" : "",
      ].join(" ")}
      type="button"
      onClick={props.onSelect}
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="grid min-w-0 gap-1">
          <span className="min-w-0 truncate text-sm font-semibold text-foreground">
            {props.conversation.title ?? "Untitled conversation"}
          </span>
          <span className="min-w-0 truncate text-xs text-muted-foreground">
            {props.agentName} / {props.conversation.userId}
          </span>
        </div>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {props.conversation.messageCount}
        </span>
      </div>
      <div className="flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>{formatRelativeTime(props.conversation.updatedAt)}</span>
        <span className="min-w-0 truncate">{props.conversation.id}</span>
      </div>
    </button>
  );
}

function ConversationDetail(props: {
  agents: StudioConfig["agents"];
  conversation: StudioMemoryConversationSummary | undefined;
  detailLoading: boolean;
  messages: StudioMemoryConversationMessages | undefined;
  steps: StudioMemoryConversationSteps | undefined;
}) {
  if (props.conversation === undefined) {
    return (
      <section className="min-h-0 overflow-auto py-4 pl-5 max-xl:col-span-2 max-xl:pl-0 max-md:col-span-1">
        <EmptyState title="No conversation selected" text="Choose a conversation to inspect." />
      </section>
    );
  }

  return (
    <section className="min-h-0 overflow-auto py-4 pl-5 max-xl:col-span-2 max-xl:pl-0 max-md:col-span-1">
      <div className="grid min-w-0 gap-5">
        <header className="grid gap-4 border-b border-border/80 pb-5">
          <div className="flex min-w-0 items-start justify-between gap-4 max-md:grid">
            <div className="grid min-w-0 gap-2">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Selected conversation
              </div>
              <h2 className="m-0 min-w-0 truncate text-2xl font-semibold leading-none text-foreground">
                {props.conversation.title ?? "Untitled conversation"}
              </h2>
              <span className="min-w-0 break-all font-mono text-xs text-muted-foreground">
                {props.conversation.id}
              </span>
            </div>
            <Badge className="border-border/80 bg-muted/45 text-foreground">
              {agentLabel(props.agents, props.conversation.agentId)}
            </Badge>
          </div>
          <div className="grid border-y border-border/80 sm:grid-cols-4 sm:divide-x sm:divide-border/80">
            <Fact label="user" value={props.conversation.userId} />
            <Fact label="messages" value={props.conversation.messageCount} />
            <Fact label="created" value={formatRelativeTime(props.conversation.createdAt)} />
            <Fact label="updated" value={formatRelativeTime(props.conversation.updatedAt)} />
          </div>
        </header>

        {props.detailLoading ? (
          <EmptyState title="Loading detail" text="Reading message and transcript data." />
        ) : (
          <div className="grid gap-4">
            {props.conversation.metadata === undefined ? null : (
              <JsonPanel title="metadata" value={props.conversation.metadata} />
            )}
            <JsonPanel title="messages" value={props.messages?.messages ?? []} />
            <JsonPanel title="transcript steps" value={props.steps?.steps ?? []} />
          </div>
        )}
      </div>
    </section>
  );
}

function JsonPanel(props: { title: string; value: unknown }) {
  const count = Array.isArray(props.value) ? props.value.length : undefined;
  return (
    <details className="group grid min-w-0 overflow-hidden border-y border-border/80" open>
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 bg-muted/10 px-3 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground marker:hidden">
        <span>{props.title}</span>
        <span className="font-medium normal-case tracking-normal">
          {count === undefined ? "JSON" : `${count} items`}
        </span>
      </summary>
      <div className="min-w-0 overflow-x-auto border-t border-border/70">
        <pre className="m-0 max-h-96 min-w-max p-4 text-xs leading-5 text-foreground">
          <code>
            <JsonSyntax text={formatJson(props.value)} />
          </code>
        </pre>
      </div>
    </details>
  );
}

function SectionLabel(props: { label: string; value: number }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3">
      <h2 className="m-0 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {props.label}
      </h2>
      <span className="text-xs font-semibold tabular-nums text-muted-foreground">
        {props.value}
      </span>
    </div>
  );
}

function Fact(props: { label: string; value: string | number }) {
  return (
    <div className="grid min-w-0 gap-1 px-3 py-3 first:pl-0 last:pr-0">
      <span className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {props.label}
      </span>
      <span className="min-w-0 truncate text-sm text-foreground" title={String(props.value)}>
        {props.value}
      </span>
    </div>
  );
}

function EmptyState(props: { title: string; text: string }) {
  return (
    <div className="grid min-h-80 place-items-center rounded-xl border border-dashed border-border/80 bg-card/35 px-6 text-center">
      <div className="grid max-w-md gap-2">
        <h2 className="m-0 text-base font-semibold text-foreground">{props.title}</h2>
        <p className="m-0 text-sm leading-6 text-muted-foreground">{props.text}</p>
      </div>
    </div>
  );
}

function MemoryEmptyDashboard(props: {
  agentCount: number;
  userCount: number;
  onRefresh: () => void;
}) {
  return (
    <section className="grid h-full min-h-0 place-items-center border-t border-border/80 px-6">
      <div className="grid w-full max-w-3xl gap-6">
        <div className="grid gap-3">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Memory store
          </div>
          <h2 className="m-0 text-2xl font-semibold leading-tight text-foreground">
            No saved conversations yet
          </h2>
          <p className="m-0 max-w-[64ch] text-sm leading-6 text-muted-foreground">
            Conversations will appear here after agents run with memory enabled. The inspector keeps
            user filters, session payloads, and transcript steps in one place.
          </p>
        </div>
        <div className="grid border-y border-border/80 sm:grid-cols-3 sm:divide-x sm:divide-border/80">
          <Fact label="users" value={props.userCount} />
          <Fact label="agents" value={props.agentCount} />
          <Fact label="conversations" value={0} />
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <Button
            className="h-8 min-h-8 rounded-md px-3 text-xs"
            type="button"
            variant="secondary"
            onClick={props.onRefresh}
          >
            Refresh
          </Button>
          <span className="text-xs leading-5 text-muted-foreground">
            Start a chat session to populate memory.
          </span>
        </div>
      </div>
    </section>
  );
}

function InlineError(props: { message: string }) {
  return (
    <div className="mb-3 border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs leading-5 text-destructive">
      {props.message}
    </div>
  );
}

function MemoryMetric(props: { label: string; value: number }) {
  return (
    <span className="inline-flex h-8 items-center gap-2 rounded-md border border-border/70 bg-background/45 px-2.5 text-xs font-medium text-muted-foreground">
      <span className="font-semibold tabular-nums text-foreground">{props.value}</span>
      {props.label}
    </span>
  );
}

function memoryTotals(
  users: StudioMemoryUsersPage["users"],
  conversations: StudioMemoryConversationSummary[],
): {
  userCount: number;
  conversationCount: number;
  messageCount: number;
} {
  return {
    userCount: users.length,
    conversationCount: conversations.length,
    messageCount: conversations.reduce(
      (total, conversation) => total + conversation.messageCount,
      0,
    ),
  };
}

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function agentLabel(agents: StudioConfig["agents"], agentId: string): string {
  return agents.find((agent) => agent.id === agentId)?.name ?? agentId;
}
