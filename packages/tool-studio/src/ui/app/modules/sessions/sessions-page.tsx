import { ActivityIcon as Activity, Trash } from "@phosphor-icons/react";
import type { StudioConfig, StudioSessionSummary } from "../../../../types";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { cn } from "../../lib/utils";
import { agentLabel, formatRelativeTime } from "../shared/format";
import type { SessionLoadState } from "../shared/types";

export function SessionsPage(props: {
  agents: StudioConfig["agents"];
  sessions: StudioSessionSummary[];
  sessionsEnabled: boolean;
  sessionLoadState: SessionLoadState;
  selectedSessionId: string;
  onOpenSession: (sessionId: string) => void;
  onViewSessionTracing: (sessionId: string) => void;
  onDeleteSession: (session: StudioSessionSummary) => void;
}) {
  if (!props.sessionsEnabled) {
    return (
      <div className="w-full rounded-lg border border-dashed border-border p-8 text-sm font-medium text-muted-foreground">
        Sessions are disabled
      </div>
    );
  }

  return (
    <section className="grid min-h-0 w-full overflow-auto pb-6 pl-0 pr-6" aria-label="Sessions">
      <div className="min-w-225 overflow-hidden rounded-xl border border-border/80 bg-card/70 p-2 shadow-sm">
        <div className="sticky top-0 z-10 grid min-h-11 grid-cols-[minmax(220px,1.3fr)_180px_120px_120px_72px] items-center gap-4 rounded-lg border border-border/60 bg-card/95 px-4 font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground backdrop-blur">
          <span>Session</span>
          <span>Agent</span>
          <span>Messages</span>
          <span>Updated</span>
          <span className="sr-only">Actions</span>
        </div>
        {props.sessionLoadState === "loading" && props.sessions.length === 0 ? (
          <div className="px-5 py-4 text-sm font-medium text-muted-foreground">
            Loading sessions
          </div>
        ) : null}
        {props.sessionLoadState === "idle" && props.sessions.length === 0 ? (
          <div className="px-5 py-4 text-sm font-medium text-muted-foreground">No sessions</div>
        ) : null}
        {props.sessions.map((session) => (
          <div
            className={cn(
              "mt-1 grid min-h-14 w-full min-w-0 grid-cols-[minmax(220px,1.3fr)_180px_120px_120px_72px] items-center gap-4 rounded-lg border border-transparent px-4 text-left text-muted-foreground transition duration-200 hover:border-primary/20 hover:bg-accent/80 hover:text-accent-foreground",
              session.id === props.selectedSessionId &&
                "border-primary/35 bg-primary/10 text-primary",
            )}
            key={session.id}
          >
            <Button
              className="col-span-4 grid h-full min-h-14 min-w-0 grid-cols-[minmax(220px,1.3fr)_180px_120px_120px] items-center justify-start gap-4 border-0 bg-transparent p-0 text-left text-inherit shadow-none hover:bg-transparent hover:text-inherit"
              type="button"
              variant="ghost"
              onClick={() => props.onOpenSession(session.id)}
            >
              <span className="grid min-w-0 gap-0.5">
                <strong className="min-w-0 truncate text-sm font-medium text-foreground">
                  {session.title ?? "Untitled chat"}
                </strong>
                <span className="min-w-0 truncate font-mono text-xs font-medium text-muted-foreground">
                  {session.id}
                </span>
              </span>
              <span className="min-w-0 truncate text-xs font-medium">
                {agentLabel(props.agents, session.agentId)}
              </span>
              <span className="text-xs font-medium tabular-nums text-muted-foreground">
                {session.messageCount} messages
              </span>
              <time className="text-xs font-medium text-muted-foreground">
                {formatRelativeTime(session.updatedAt)}
              </time>
            </Button>
            <span className="flex items-center justify-end gap-1">
              <Button
                aria-label={`View tracing for ${session.title ?? "Untitled chat"}`}
                className="h-7 min-h-7 w-7 border-0 bg-transparent p-0 text-muted-foreground opacity-80 hover:bg-transparent hover:text-primary hover:opacity-100 [&_svg]:h-3.5 [&_svg]:w-3.5"
                size="icon"
                type="button"
                variant="ghost"
                onClick={(event) => {
                  event.stopPropagation();
                  props.onViewSessionTracing(session.id);
                }}
              >
                <Activity aria-hidden="true" />
              </Button>
              <Button
                aria-label={`Delete ${session.title ?? "Untitled chat"}`}
                className="h-7 min-h-7 w-7 border-0 bg-transparent p-0 text-muted-foreground opacity-80 hover:bg-transparent hover:text-destructive hover:opacity-100 [&_svg]:h-3.5 [&_svg]:w-3.5"
                size="icon"
                type="button"
                variant="ghost"
                onClick={(event) => {
                  event.stopPropagation();
                  props.onDeleteSession(session);
                }}
              >
                <Trash aria-hidden="true" />
              </Button>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

export function DeleteSessionDialog(props: {
  session: StudioSessionSummary | undefined;
  onOpenChange: (open: boolean) => void;
  onConfirm: (session: StudioSessionSummary) => void;
}) {
  const title = props.session?.title ?? "Untitled chat";

  return (
    <Dialog open={props.session !== undefined} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete session</DialogTitle>
          <DialogDescription>
            Delete "{title}" and its traces. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => props.onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => {
              if (props.session !== undefined) {
                props.onConfirm(props.session);
              }
            }}
          >
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
