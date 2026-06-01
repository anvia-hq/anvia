import { useCallback, useEffect, useState } from "react";
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

  const visibleConversations =
    selectedUserId.length === 0
      ? conversations
      : conversations.filter((conversation) => conversation.userId === selectedUserId);
  const selectedConversation =
    conversations.find((conversation) => conversation.id === selectedConversationId) ??
    visibleConversations[0];

  return (
    <section
      className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-background/55"
      aria-label="Memory"
    >
      <header className="bg-background/70 pb-5 pl-0 pr-6 pt-0 backdrop-blur">
        <div className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-end gap-4 max-md:grid-cols-1">
          <div className="grid min-w-0 gap-2">
            <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.24em] text-primary">
              Conversation store
            </div>
            <h1 className="m-0 text-2xl font-semibold leading-none tracking-tight text-foreground">
              Memory
            </h1>
            <p className="m-0 max-w-[62ch] text-sm leading-6 text-muted-foreground">
              Stored users, conversations, raw messages, and transcript steps from the Studio
              session store.
            </p>
          </div>
          <Button
            className="h-9 min-h-9 rounded-lg px-3 font-mono text-xs"
            type="button"
            variant="secondary"
            disabled={loading}
            onClick={() => void loadMemory()}
          >
            Refresh
          </Button>
        </div>
      </header>

      <div className="min-h-0 overflow-auto pb-6 pl-0 pr-6">
        {!props.enabled ? (
          <EmptyState title="Memory unavailable" text="This Studio runtime has no session store." />
        ) : loading && conversations.length === 0 ? (
          <EmptyState title="Loading memory" text="Reading users and conversations." />
        ) : error.length > 0 && conversations.length === 0 ? (
          <EmptyState title="Memory error" text={error} />
        ) : (
          <div className="grid min-h-0 gap-4 xl:grid-cols-[280px_minmax(320px,0.8fr)_minmax(0,1.2fr)]">
            <section className="grid content-start gap-2 rounded-xl border border-border/80 bg-card/45 p-3">
              <PanelHeader title="Users" value={users.length} />
              <Button
                className="h-auto min-h-9 justify-start rounded-lg px-3 py-2 text-left font-mono text-xs"
                type="button"
                variant={selectedUserId.length === 0 ? "secondary" : "ghost"}
                onClick={() => setSelectedUserId("")}
              >
                All users
              </Button>
              {users.map((user) => (
                <Button
                  className="grid h-auto min-h-14 justify-start rounded-lg px-3 py-2 text-left"
                  type="button"
                  variant={selectedUserId === user.userId ? "secondary" : "ghost"}
                  onClick={() => setSelectedUserId(user.userId)}
                  key={user.userId}
                >
                  <span className="min-w-0 truncate font-mono text-xs font-semibold">
                    {user.userId}
                  </span>
                  <span className="min-w-0 truncate text-xs text-muted-foreground">
                    {user.conversationCount} conversations ·{" "}
                    {formatRelativeTime(user.lastInteractionAt)}
                  </span>
                </Button>
              ))}
            </section>

            <section className="grid content-start gap-2 rounded-xl border border-border/80 bg-card/45 p-3">
              <PanelHeader title="Conversations" value={visibleConversations.length} />
              {visibleConversations.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border/80 bg-background/45 px-3 py-8 text-center text-sm text-muted-foreground">
                  No conversations.
                </div>
              ) : (
                visibleConversations.map((conversation) => (
                  <ConversationButton
                    key={conversation.id}
                    conversation={conversation}
                    agentName={agentLabel(props.agents, conversation.agentId)}
                    active={conversation.id === selectedConversationId}
                    onSelect={() => setSelectedConversationId(conversation.id)}
                  />
                ))
              )}
            </section>

            <section className="grid min-h-0 content-start gap-4">
              {selectedConversation === undefined ? (
                <EmptyState
                  title="No conversation selected"
                  text="Choose a conversation to inspect."
                />
              ) : (
                <>
                  <article className="grid gap-3 rounded-xl border border-border/80 bg-card/45 p-5">
                    <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
                      <div className="grid min-w-0 gap-1">
                        <h2 className="m-0 min-w-0 truncate text-lg font-semibold text-foreground">
                          {selectedConversation.title ?? "Untitled conversation"}
                        </h2>
                        <span className="min-w-0 break-all font-mono text-xs text-muted-foreground">
                          {selectedConversation.id}
                        </span>
                      </div>
                      <Badge className="border-primary/35 bg-primary/10 text-primary">
                        {agentLabel(props.agents, selectedConversation.agentId)}
                      </Badge>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-3">
                      <Fact label="user" value={selectedConversation.userId} />
                      <Fact label="messages" value={selectedConversation.messageCount} />
                      <Fact
                        label="updated"
                        value={formatRelativeTime(selectedConversation.updatedAt)}
                      />
                    </div>
                  </article>
                  {detailLoading ? (
                    <EmptyState
                      title="Loading detail"
                      text="Reading message and transcript data."
                    />
                  ) : (
                    <div className="grid gap-4">
                      <JsonPanel title="messages" value={messages?.messages ?? []} />
                      <JsonPanel title="steps" value={steps?.steps ?? []} />
                    </div>
                  )}
                </>
              )}
            </section>
          </div>
        )}
      </div>
    </section>
  );
}

function ConversationButton(props: {
  conversation: StudioMemoryConversationSummary;
  agentName: string;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <Button
      className="grid h-auto min-h-20 justify-start gap-2 rounded-lg px-3 py-3 text-left"
      type="button"
      variant={props.active ? "secondary" : "ghost"}
      onClick={props.onSelect}
    >
      <div className="grid min-w-0 gap-1">
        <span className="min-w-0 truncate text-sm font-semibold text-foreground">
          {props.conversation.title ?? "Untitled conversation"}
        </span>
        <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">
          {props.agentName} · {props.conversation.userId}
        </span>
      </div>
      <span className="font-mono text-[11px] text-muted-foreground">
        {props.conversation.messageCount} messages ·{" "}
        {formatRelativeTime(props.conversation.updatedAt)}
      </span>
    </Button>
  );
}

function JsonPanel(props: { title: string; value: unknown }) {
  const count = Array.isArray(props.value) ? props.value.length : undefined;
  return (
    <section className="grid min-w-0 overflow-hidden rounded-xl border border-border/80 bg-card/45">
      <div className="flex min-h-10 items-center justify-between gap-3 border-b border-border/80 bg-muted/20 px-4">
        <PanelHeader title={props.title} {...(count === undefined ? {} : { value: count })} />
      </div>
      <div className="min-w-0 overflow-x-auto">
        <pre className="m-0 max-h-96 min-w-max p-4 font-mono text-[12px] leading-5 text-foreground">
          <code>
            <JsonSyntax text={JSON.stringify(props.value, null, 2)} />
          </code>
        </pre>
      </div>
    </section>
  );
}

function PanelHeader(props: { title: string; value?: number }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3">
      <h2 className="m-0 font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
        {props.title}
      </h2>
      {props.value === undefined ? null : (
        <span className="font-mono text-[10px] font-semibold text-muted-foreground">
          {props.value}
        </span>
      )}
    </div>
  );
}

function Fact(props: { label: string; value: string | number }) {
  return (
    <div className="grid min-w-0 gap-1 rounded-lg bg-background/45 px-3 py-2">
      <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {props.label}
      </span>
      <span
        className="min-w-0 truncate font-mono text-xs text-foreground"
        title={String(props.value)}
      >
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

function agentLabel(agents: StudioConfig["agents"], agentId: string): string {
  return agents.find((agent) => agent.id === agentId)?.name ?? agentId;
}
