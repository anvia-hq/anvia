import { ArrowClockwise, X } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { StudioSandboxViewConnection, StudioSandboxViewSummary } from "../../../../types";
import { Button } from "../../components/ui/button";
import { StudioIcon } from "../../components/ui/icon";
import { StudioStatusBadge, StudioSurface } from "../../components/ui/studio";
import { cn } from "../../lib/utils";
import { requestJson } from "../shared/request";

type BrowserControlLeaseResponse = {
  id: string;
  ownerId: string;
  expiresAt: string;
};

type BrowserControlStateResponse = {
  mode: "agent" | "human";
  ownerId?: string;
  expiresAt?: string;
};

type ViewerStatus = "connecting" | "connected" | "disconnected" | "error";

export function StudioBrowserView(props: {
  sandboxRef: string;
  view: StudioSandboxViewSummary;
  className?: string;
  onClose?: () => void;
  onError: (error: unknown) => void;
}) {
  const ownerId = useRef(crypto.randomUUID());
  const onErrorRef = useRef(props.onError);
  onErrorRef.current = props.onError;
  const targetRef = useRef<HTMLDivElement | null>(null);
  const rfbRef = useRef<InstanceType<typeof import("@novnc/novnc").default> | undefined>(undefined);
  const [lease, setLease] = useState<BrowserControlLeaseResponse | undefined>();
  const leaseRef = useRef<BrowserControlLeaseResponse | undefined>(undefined);
  const [control, setControl] = useState<BrowserControlStateResponse>({ mode: "agent" });
  const [pending, setPending] = useState(false);
  const [viewerStatus, setViewerStatus] = useState<ViewerStatus>("connecting");
  const [viewerError, setViewerError] = useState("");
  const [connectionSequence, setConnectionSequence] = useState(0);
  const base = `/sandboxes/${encodeURIComponent(props.sandboxRef)}/views/${encodeURIComponent(props.view.id)}`;
  const leaseTimeoutMs = 30_000;
  const leaseId = lease?.id;
  const heldByThisViewer = lease?.ownerId === ownerId.current;
  const reportError = useCallback((error: unknown) => onErrorRef.current(error), []);

  const refreshControl = useCallback(
    async (signal?: AbortSignal) => {
      const state = await requestJson<BrowserControlStateResponse>(
        `${base}/control`,
        "Browser control",
        signal,
      );
      setControl(state);
      if (state.mode === "agent") {
        leaseRef.current = undefined;
        setLease(undefined);
      }
    },
    [base],
  );

  useEffect(() => {
    const controller = new AbortController();
    void refreshControl(controller.signal).catch((error: unknown) => {
      if (!controller.signal.aborted) reportError(error);
    });
    const interval = window.setInterval(() => {
      void refreshControl(controller.signal).catch((error: unknown) => {
        if (!controller.signal.aborted) reportError(error);
      });
    }, 5_000);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [refreshControl, reportError]);

  useEffect(() => {
    if (leaseId === undefined) return;
    const controller = new AbortController();
    const interval = window.setInterval(() => {
      void requestJson<BrowserControlLeaseResponse>(
        `${base}/control/renew`,
        "Browser control renewal",
        controller.signal,
        "default",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ leaseId, leaseTimeoutMs }),
        },
      )
        .then((next) => {
          leaseRef.current = next;
          setLease(next);
          setControl({ mode: "human", ownerId: next.ownerId, expiresAt: next.expiresAt });
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) {
            setLease(undefined);
            leaseRef.current = undefined;
            reportError(error);
          }
        });
    }, 10_000);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [base, leaseId, reportError]);

  useEffect(
    () => () => {
      const activeLease = leaseRef.current;
      if (activeLease === undefined) return;
      void fetch(`${base}/control/release`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ leaseId: activeLease.id }),
        keepalive: true,
      });
    },
    [base],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: Incrementing the retry counter intentionally reconnects the noVNC client.
  useEffect(() => {
    const target = targetRef.current;
    if (target === null) return;
    const controller = new AbortController();
    setViewerStatus("connecting");
    setViewerError("");
    target.replaceChildren();

    void Promise.all([
      requestJson<StudioSandboxViewConnection>(
        `${base}/connection`,
        "Browser connection",
        controller.signal,
        "no-store",
      ),
      import("@novnc/novnc"),
    ])
      .then(([connection, noVnc]) => {
        if (controller.signal.aborted) return;
        const websocketUrl = new URL(connection.websocketPath, window.location.origin);
        websocketUrl.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const credentials =
          connection.authentication.type === "password"
            ? { username: "", password: connection.authentication.password, target: "" }
            : undefined;
        const rfb = new noVnc.default(target, websocketUrl.href, {
          ...(credentials === undefined ? {} : { credentials }),
        });
        rfbRef.current = rfb;
        rfb.scaleViewport = true;
        rfb.resizeSession = false;
        rfb.viewOnly = leaseRef.current === undefined;
        rfb.background = "rgb(18, 18, 18)";
        rfb.addEventListener("connect", () => {
          if (!controller.signal.aborted) setViewerStatus("connected");
        });
        rfb.addEventListener("credentialsrequired", () => {
          if (credentials === undefined) {
            setViewerStatus("error");
            setViewerError("The browser desktop requires credentials that Studio does not have.");
            return;
          }
          rfb.sendCredentials(credentials);
        });
        rfb.addEventListener("securityfailure", (event) => {
          setViewerStatus("error");
          setViewerError(event.detail.reason ?? "Browser desktop authentication failed.");
        });
        rfb.addEventListener("disconnect", (event) => {
          if (controller.signal.aborted) return;
          setViewerStatus(event.detail.clean ? "disconnected" : "error");
          if (!event.detail.clean)
            setViewerError("The browser desktop connection was interrupted.");
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setViewerStatus("error");
        setViewerError(error instanceof Error ? error.message : "Unable to open browser desktop.");
        reportError(error);
      });

    return () => {
      controller.abort();
      rfbRef.current?.disconnect();
      rfbRef.current = undefined;
      target.replaceChildren();
    };
  }, [base, connectionSequence, reportError]);

  useEffect(() => {
    const rfb = rfbRef.current;
    if (rfb === undefined) return;
    rfb.viewOnly = lease === undefined;
    if (lease === undefined) rfb.blur();
    else rfb.focus({ preventScroll: true });
  }, [lease]);

  const acquire = useCallback(async () => {
    setPending(true);
    try {
      const next = await requestJson<BrowserControlLeaseResponse>(
        `${base}/control/acquire`,
        "Browser control",
        undefined,
        "default",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ownerId: ownerId.current, leaseTimeoutMs }),
        },
      );
      leaseRef.current = next;
      setLease(next);
      setControl({ mode: "human", ownerId: next.ownerId, expiresAt: next.expiresAt });
    } catch (error) {
      reportError(error);
    } finally {
      setPending(false);
    }
  }, [base, reportError]);

  const release = useCallback(async () => {
    if (lease === undefined) return;
    setPending(true);
    try {
      await requestJson<{ released: boolean }>(
        `${base}/control/release`,
        "Browser control",
        undefined,
        "default",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ leaseId: lease.id }),
        },
      );
      leaseRef.current = undefined;
      setLease(undefined);
      setControl({ mode: "agent" });
    } catch (error) {
      reportError(error);
    } finally {
      setPending(false);
    }
  }, [base, lease, reportError]);

  return (
    <StudioSurface
      className={cn(
        "grid h-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-[#121212]",
        props.className,
      )}
    >
      <div className="flex min-h-12 items-center justify-between gap-3 border-b border-white/10 bg-background px-3 py-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="truncate text-sm font-semibold text-foreground">{props.view.label}</span>
          <StudioStatusBadge>
            {viewerStatus === "connected"
              ? heldByThisViewer
                ? "You control"
                : "Agent control"
              : viewerStatus}
          </StudioStatusBadge>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {heldByThisViewer ? (
            <Button
              disabled={pending}
              size="sm"
              type="button"
              variant="secondary"
              onClick={() => void release()}
            >
              Release control
            </Button>
          ) : (
            <Button
              disabled={pending || control.mode === "human" || viewerStatus !== "connected"}
              size="sm"
              type="button"
              variant="secondary"
              onClick={() => void acquire()}
            >
              {control.mode === "human" ? "In human control" : "Take control"}
            </Button>
          )}
          {props.onClose === undefined ? null : (
            <Button
              aria-label="Close browser workspace"
              className="size-8 min-h-8 p-0"
              size="icon"
              type="button"
              variant="ghost"
              onClick={props.onClose}
            >
              <StudioIcon icon={X} />
            </Button>
          )}
        </div>
      </div>
      <div className="relative grid min-h-0 min-w-0 place-items-stretch overflow-hidden bg-[#121212]">
        <section
          aria-label="Live browser desktop"
          className="h-full min-h-0 min-w-0 overflow-hidden [&_canvas]:outline-none"
          data-studio-browser-view=""
          ref={targetRef}
        />
        {viewerStatus === "connecting" ? (
          <div className="absolute inset-0 grid place-items-center bg-[#121212] text-sm text-white/60">
            Connecting to browser…
          </div>
        ) : null}
        {viewerStatus === "error" || viewerStatus === "disconnected" ? (
          <div className="absolute inset-0 grid place-items-center bg-[#121212] p-6 text-center">
            <div className="grid max-w-sm gap-3">
              <p className="m-0 text-sm text-white/70">
                {viewerError || "Browser desktop disconnected."}
              </p>
              <Button
                className="mx-auto"
                size="sm"
                type="button"
                variant="secondary"
                onClick={() => setConnectionSequence((current) => current + 1)}
              >
                <StudioIcon icon={ArrowClockwise} />
                Reconnect
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </StudioSurface>
  );
}
