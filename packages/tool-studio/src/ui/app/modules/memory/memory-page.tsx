import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  StudioConfig,
  StudioMemorySourceConversationMessages,
  StudioMemorySourceConversationSteps,
  StudioMemorySourceConversationSummary,
  StudioMemorySourceConversationsPage,
  StudioMemorySourceSummary,
  StudioMemorySourcesPage,
  StudioMemorySourceUsersPage,
} from "../../../../types";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import {
  StudioEmptyState,
  StudioHeaderMetric,
  StudioPageContent,
  StudioPageHeader,
  StudioPageShell,
} from "../../components/ui/studio";
import { formatRelativeTime } from "../shared/format";
import { JsonSyntax } from "../shared/renderers";
import { MemoryGenerationLedger } from "./memory-generation-ledger";

export function MemoryPage(props: { agents: StudioConfig["agents"]; enabled: boolean }) {
  const [sources, setSources] = useState<StudioMemorySourceSummary[]>([]);
  const [selectedSourceRef, setSelectedSourceRef] = useState("");
  const [users, setUsers] = useState<StudioMemorySourceUsersPage["users"]>([]);
  const [conversations, setConversations] = useState<StudioMemorySourceConversationSummary[]>([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedConversationRef, setSelectedConversationRef] = useState("");
  const [messages, setMessages] = useState<StudioMemorySourceConversationMessages | undefined>();
  const [steps, setSteps] = useState<StudioMemorySourceConversationSteps | undefined>();
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const memoryRequest = useRef(0);

  const selectedSource = sources.find((source) => source.ref === selectedSourceRef);

  const loadSources = useCallback(async () => {
    if (!props.enabled) {
      setSources([]);
      setSelectedSourceRef("");
      return;
    }
    setSourcesLoading(true);
    setError("");
    try {
      const response = await fetch("/memory/sources");
      if (!response.ok) throw new Error(`Memory sources failed with HTTP ${response.status}`);
      const body = (await response.json()) as StudioMemorySourcesPage;
      setSources(body.sources);
      setSelectedSourceRef((current) =>
        body.sources.some((source) => source.ref === current)
          ? current
          : defaultSourceRef(body.sources),
      );
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setSourcesLoading(false);
    }
  }, [props.enabled]);

  useEffect(() => {
    void loadSources();
  }, [loadSources]);

  const loadMemory = useCallback(async () => {
    const requestId = memoryRequest.current + 1;
    memoryRequest.current = requestId;
    if (!props.enabled || selectedSource === undefined || !selectedSource.available) {
      setUsers([]);
      setConversations([]);
      setMessages(undefined);
      setSteps(undefined);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const sourcePath = `/memory/sources/${encodeURIComponent(selectedSource.ref)}`;
      const [usersResponse, conversationsResponse] = await Promise.all([
        fetch(`${sourcePath}/users?limit=50`),
        fetch(`${sourcePath}/conversations?limit=100`),
      ]);
      if (!usersResponse.ok) {
        throw new Error(`Memory users failed with HTTP ${usersResponse.status}`);
      }
      if (!conversationsResponse.ok) {
        throw new Error(`Memory conversations failed with HTTP ${conversationsResponse.status}`);
      }
      const usersBody = (await usersResponse.json()) as StudioMemorySourceUsersPage;
      const conversationsBody =
        (await conversationsResponse.json()) as StudioMemorySourceConversationsPage;
      if (memoryRequest.current !== requestId) return;
      setUsers(usersBody.users);
      setConversations(conversationsBody.conversations);
      setSelectedConversationRef(
        (current) =>
          conversationsBody.conversations.find((conversation) => conversation.ref === current)
            ?.ref ??
          conversationsBody.conversations[0]?.ref ??
          "",
      );
    } catch (loadError) {
      if (memoryRequest.current === requestId) {
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      }
    } finally {
      if (memoryRequest.current === requestId) setLoading(false);
    }
  }, [props.enabled, selectedSource]);

  useEffect(() => {
    setSelectedUserId("");
    setSelectedConversationRef("");
    setUsers([]);
    setConversations([]);
    setMessages(undefined);
    setSteps(undefined);
    void loadMemory();
  }, [loadMemory]);

  useEffect(() => {
    if (
      !props.enabled ||
      selectedSource === undefined ||
      !selectedSource.available ||
      selectedConversationRef.length === 0
    ) {
      setMessages(undefined);
      setSteps(undefined);
      return;
    }
    const sourceRef = selectedSource.ref;
    let cancelled = false;
    async function loadDetail() {
      setDetailLoading(true);
      setError("");
      try {
        const conversationPath = `/memory/sources/${encodeURIComponent(
          sourceRef,
        )}/conversations/${encodeURIComponent(selectedConversationRef)}`;
        const [messagesResponse, stepsResponse] = await Promise.all([
          fetch(`${conversationPath}/messages`),
          fetch(`${conversationPath}/steps`),
        ]);
        if (!messagesResponse.ok) {
          throw new Error(`Conversation messages failed with HTTP ${messagesResponse.status}`);
        }
        if (!stepsResponse.ok) {
          throw new Error(`Conversation steps failed with HTTP ${stepsResponse.status}`);
        }
        if (!cancelled) {
          setMessages((await messagesResponse.json()) as StudioMemorySourceConversationMessages);
          setSteps((await stepsResponse.json()) as StudioMemorySourceConversationSteps);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : String(loadError));
          setMessages(undefined);
          setSteps(undefined);
        }
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    }
    void loadDetail();
    return () => {
      cancelled = true;
    };
  }, [props.enabled, selectedConversationRef, selectedSource]);

  const visibleConversations = useMemo(
    () =>
      selectedUserId.length === 0
        ? conversations
        : conversations.filter((conversation) => conversation.userId === selectedUserId),
    [conversations, selectedUserId],
  );
  const totals = useMemo(() => memoryTotals(users, conversations), [conversations, users]);
  const selectedConversation =
    visibleConversations.find((conversation) => conversation.ref === selectedConversationRef) ??
    visibleConversations[0];

  useEffect(() => {
    if (visibleConversations.length === 0) {
      setSelectedConversationRef("");
      return;
    }
    if (
      !visibleConversations.some((conversation) => conversation.ref === selectedConversationRef)
    ) {
      setSelectedConversationRef(visibleConversations[0]?.ref ?? "");
    }
  }, [selectedConversationRef, visibleConversations]);

  return (
    <StudioPageShell className="grid-rows-[auto_minmax(0,1fr)]" aria-label="Memory">
      <StudioPageHeader
        title="Memory"
        description="Inspect persisted agent conversations directly. Studio sessions appear only as a fallback for agents without configured memory."
        action={
          <div className="flex min-w-0 flex-wrap justify-end gap-2 max-sm:justify-start">
            {sources.length === 0 ? null : (
              <Select value={selectedSourceRef} onValueChange={setSelectedSourceRef}>
                <SelectTrigger className="h-8 min-h-8 w-60 rounded-md border-border text-xs max-sm:w-full">
                  <SelectValue placeholder="Memory source" />
                </SelectTrigger>
                <SelectContent align="end">
                  {sources.map((source) => (
                    <SelectItem value={source.ref} key={source.ref}>
                      {source.label}
                      {source.available ? "" : " (unavailable)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <StudioHeaderMetric label="users" value={totals.userCount} />
            <StudioHeaderMetric label="conversations" value={totals.conversationCount} />
            <StudioHeaderMetric label="messages" value={totals.messageCount} />
            <Button
              className="h-8 min-h-8 rounded-md px-3 text-xs"
              type="button"
              variant="secondary"
              disabled={sourcesLoading || loading}
              onClick={() => void loadSources()}
            >
              Refresh
            </Button>
          </div>
        }
      />

      <StudioPageContent className="overflow-hidden">
        {!props.enabled ? (
          <StudioEmptyState
            title="Memory unavailable"
            text="No agent memory or Studio session store is configured."
          />
        ) : sourcesLoading && sources.length === 0 ? (
          <StudioEmptyState title="Loading memory" text="Discovering configured memory sources." />
        ) : error.length > 0 && sources.length === 0 ? (
          <StudioEmptyState title="Memory error" text={error} />
        ) : selectedSource === undefined ? (
          <StudioEmptyState title="No memory sources" text="No registered agent exposes memory." />
        ) : !selectedSource.available ? (
          <UnavailableSource source={selectedSource} />
        ) : loading && conversations.length === 0 ? (
          <StudioEmptyState title="Loading memory" text={`Reading ${selectedSource.label}.`} />
        ) : error.length > 0 && conversations.length === 0 ? (
          <StudioEmptyState title="Memory error" text={error} />
        ) : conversations.length === 0 ? (
          <MemoryEmptyDashboard
            source={selectedSource}
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
            <div className="grid min-h-0 grid-cols-[260px_minmax(320px,0.78fr)_minmax(0,1.22fr)] overflow-hidden border-t border-hair max-xl:grid-cols-[240px_minmax(0,1fr)] max-xl:grid-rows-[minmax(240px,0.42fr)_minmax(0,1fr)] max-md:grid-cols-1 max-md:grid-rows-[auto_minmax(240px,0.38fr)_minmax(0,1fr)]">
              <MemoryUserRail
                users={users}
                selectedUserId={selectedUserId}
                totalConversations={conversations.length}
                onSelect={setSelectedUserId}
              />
              <ConversationLedger
                agents={props.agents}
                conversations={visibleConversations}
                selectedConversationRef={selectedConversation?.ref ?? ""}
                source={selectedSource}
                onSelect={setSelectedConversationRef}
              />
              <ConversationDetail
                agents={props.agents}
                conversation={selectedConversation}
                detailLoading={detailLoading}
                messages={messages}
                source={selectedSource}
                steps={steps}
              />
            </div>
          </div>
        )}
      </StudioPageContent>
    </StudioPageShell>
  );
}

function MemoryUserRail(props: {
  users: StudioMemorySourceUsersPage["users"];
  selectedUserId: string;
  totalConversations: number;
  onSelect: (userId: string) => void;
}) {
  return (
    <aside className="min-h-0 overflow-auto border-r border-hair pr-3 max-md:border-b max-md:border-r-0 max-md:pr-0">
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
        "grid min-w-0 gap-1 rounded-lg border border-transparent px-3 py-2.5 text-left transition duration-200 hover:border-hair hover:bg-transparent hover:text-foreground focus-visible:border-ring focus-visible:outline-none",
        props.active ? "border-hair bg-row-selected" : "",
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
  conversations: StudioMemorySourceConversationSummary[];
  selectedConversationRef: string;
  source: StudioMemorySourceSummary;
  onSelect: (conversationRef: string) => void;
}) {
  return (
    <section className="min-h-0 overflow-auto border-r border-hair px-4 max-xl:border-r-0 max-xl:pr-0 max-md:border-b max-md:px-0">
      <div className="grid gap-3 py-4">
        <SectionLabel label="Conversations" value={props.conversations.length} />
        {props.conversations.length === 0 ? (
          <div className="border-y border-dashed border-hair px-3 py-8 text-center text-sm text-muted-foreground">
            No conversations for this user.
          </div>
        ) : (
          <div className="grid border-y border-hair">
            {props.conversations.map((conversation) => (
              <ConversationRow
                active={conversation.ref === props.selectedConversationRef}
                agentName={sourceAgentLabel(props.agents, props.source, conversation.agentIds)}
                conversation={conversation}
                key={conversation.ref}
                onSelect={() => props.onSelect(conversation.ref)}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function ConversationRow(props: {
  conversation: StudioMemorySourceConversationSummary;
  agentName: string;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      className={[
        "grid min-w-0 gap-2 border-b border-hair px-3 py-3 text-left transition duration-200 last:border-b-0 hover:bg-transparent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        props.active ? "bg-row-selected" : "",
      ].join(" ")}
      type="button"
      onClick={props.onSelect}
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="grid min-w-0 gap-1">
          <span className="min-w-0 truncate text-sm font-semibold text-foreground">
            {props.conversation.title ?? props.conversation.sessionId}
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
        <span className="min-w-0 truncate">{props.conversation.sessionId}</span>
      </div>
    </button>
  );
}

function ConversationDetail(props: {
  agents: StudioConfig["agents"];
  conversation: StudioMemorySourceConversationSummary | undefined;
  detailLoading: boolean;
  messages: StudioMemorySourceConversationMessages | undefined;
  source: StudioMemorySourceSummary;
  steps: StudioMemorySourceConversationSteps | undefined;
}) {
  if (props.conversation === undefined) {
    return (
      <section className="min-h-0 overflow-auto py-4 pl-5 max-xl:col-span-2 max-xl:pl-0 max-md:col-span-1">
        <StudioEmptyState
          title="No conversation selected"
          text="Choose a conversation to inspect."
        />
      </section>
    );
  }

  return (
    <section className="min-h-0 overflow-auto py-4 pl-5 max-xl:col-span-2 max-xl:pl-0 max-md:col-span-1">
      <div className="grid min-w-0 gap-5">
        <header className="grid gap-4 border-b border-hair pb-5">
          <div className="flex min-w-0 items-start justify-between gap-4 max-md:grid">
            <div className="grid min-w-0 gap-2">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Persisted conversation
              </div>
              <h2 className="m-0 min-w-0 truncate text-2xl font-semibold leading-none text-foreground">
                {props.conversation.title ?? props.conversation.sessionId}
              </h2>
              <span className="min-w-0 break-all font-mono text-xs text-muted-foreground">
                {props.conversation.ref}
              </span>
            </div>
            <div className="flex flex-wrap justify-end gap-2 max-md:justify-start">
              <Badge className="border-hair bg-muted text-foreground">
                {props.source.storeKind ?? props.source.kind}
              </Badge>
              <Badge className="border-hair bg-muted text-foreground">
                {sourceAgentLabel(props.agents, props.source, props.conversation.agentIds)}
              </Badge>
            </div>
          </div>
          <div className="grid border-y border-hair sm:grid-cols-4 sm:divide-x sm:divide-hair">
            <Fact label="user" value={props.conversation.userId} />
            <Fact label="messages" value={props.conversation.messageCount} />
            <Fact label="created" value={formatRelativeTime(props.conversation.createdAt)} />
            <Fact label="updated" value={formatRelativeTime(props.conversation.updatedAt)} />
          </div>
        </header>

        {props.detailLoading ? (
          <StudioEmptyState title="Loading detail" text="Reading persisted messages." />
        ) : (
          <div className="grid gap-4">
            {props.conversation.metadata === undefined ? null : (
              <JsonPanel title="metadata" value={props.conversation.metadata} />
            )}
            <MemoryGenerationLedger records={props.messages?.records ?? []} />
            <JsonPanel title="messages" value={props.messages?.messages ?? []} />
            <JsonPanel title="message records" value={props.messages?.records ?? []} />
            <JsonPanel title="derived transcript" value={props.steps?.steps ?? []} />
          </div>
        )}
      </div>
    </section>
  );
}

function UnavailableSource(props: { source: StudioMemorySourceSummary }) {
  return (
    <StudioEmptyState
      className="h-full"
      title={`${props.source.label} is not inspectable`}
      text={props.source.reason ?? "This memory store does not expose read-only discovery."}
    />
  );
}

function JsonPanel(props: { title: string; value: unknown }) {
  const count = Array.isArray(props.value) ? props.value.length : undefined;
  return (
    <details className="group grid min-w-0 overflow-hidden border-y border-hair" open>
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 bg-muted px-3 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground marker:hidden">
        <span>{props.title}</span>
        <span className="font-medium normal-case tracking-normal">
          {count === undefined ? "JSON" : `${count} items`}
        </span>
      </summary>
      <div className="min-w-0 overflow-x-auto border-t border-hair">
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

function MemoryEmptyDashboard(props: {
  source: StudioMemorySourceSummary;
  userCount: number;
  onRefresh: () => void;
}) {
  return (
    <StudioEmptyState
      className="h-full"
      title="No saved conversations yet"
      text={`Conversations will appear here after the connected agent writes to ${props.source.label}. ${props.userCount} users are currently available.`}
      action={
        <div className="flex min-w-0 flex-wrap items-center justify-center gap-3">
          <Button
            className="h-8 min-h-8 rounded-md px-3 text-xs"
            type="button"
            variant="secondary"
            onClick={props.onRefresh}
          >
            Refresh
          </Button>
          <span className="text-xs leading-5 text-muted-foreground">
            Existing database conversations are discovered automatically.
          </span>
        </div>
      }
    />
  );
}

function InlineError(props: { message: string }) {
  return (
    <div className="mb-3 border border-status-danger-ink bg-status-danger-fill px-3 py-2 text-xs leading-5 text-destructive">
      {props.message}
    </div>
  );
}

function memoryTotals(
  users: StudioMemorySourceUsersPage["users"],
  conversations: StudioMemorySourceConversationSummary[],
): { userCount: number; conversationCount: number; messageCount: number } {
  return {
    userCount: users.length,
    conversationCount: conversations.length,
    messageCount: conversations.reduce(
      (total, conversation) => total + conversation.messageCount,
      0,
    ),
  };
}

function defaultSourceRef(sources: StudioMemorySourceSummary[]): string {
  return (
    sources.find((source) => source.kind === "agent" && source.available)?.ref ??
    sources.find((source) => source.available)?.ref ??
    sources[0]?.ref ??
    ""
  );
}

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function sourceAgentLabel(
  agents: StudioConfig["agents"],
  source: StudioMemorySourceSummary,
  agentIds: string[],
): string {
  if (agentIds.length === 1) {
    const agentId = agentIds[0] ?? "agent";
    return agents.find((agent) => agent.id === agentId)?.name ?? agentId;
  }
  return source.label;
}
