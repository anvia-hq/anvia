import type RFB from "@novnc/novnc";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import { type PrimitiveProps } from "../primitives";
import type { RelayReconnectOptions, RelayStatus } from "../relay/connection";
import { DefaultStatus } from "../relay/status";
import { type TicketSource, resolveTicket } from "../relay/ticket";
import { DesktopConnection, type SandboxDesktopControl } from "./connection";

export interface SandboxDesktopHandle {
  focus(): void;
  /** Reconnect now, after the viewer gave up. */
  reconnect(): void;
  /** Take control, which pauses the agent. */
  takeOver(): void;
  /** Hand control back. */
  release(): void;
}

export interface SandboxDesktopNotice {
  code: string;
  message: string;
}

/** What `renderControls` is given to draw its own take-over bar. */
export interface SandboxDesktopControlsState {
  status: RelayStatus;
  /** Undefined until the relay has said who has control. */
  control: SandboxDesktopControl | undefined;
  /** This viewer cannot send input, because of the prop or because the ticket says so. */
  readOnly: boolean;
  /** The latest failed request, such as taking over while someone else holds control. */
  notice: SandboxDesktopNotice | undefined;
  takeOver(): void;
  release(): void;
}

export type SandboxDesktopProps = Omit<PrimitiveProps<"div">, "children" | "onError"> & {
  /**
   * The hub's desktop endpoint (`hub.handleDesktopUpgrade`): `ws:`/`wss:`, `http:`/`https:`, or a
   * path relative to this page.
   */
  url: string;
  /**
   * A one-time ticket, or a function returning one. Pass a function: tickets are single use, so
   * each reconnect needs a fresh one. It travels as a WebSocket subprotocol, not in the URL.
   */
  ticket?: TicketSource;
  /** Watch only. The server enforces it too; this also stops the viewer sending input. */
  readOnly?: boolean;
  /** Scale the desktop to fit the element. Default true. */
  scaleToFit?: boolean;
  /**
   * JPEG quality asked of the server, 0 (smallest, blockiest) to 9 (best, most data). Default 6.
   * Lower it for a slow link; it applies to the live connection.
   */
  qualityLevel?: number;
  /**
   * How hard the server compresses, 0 (fastest, most data) to 9 (slowest, least data). Default 2,
   * which keeps the server's CPU low. Raise it for a slow link; it applies to the live connection.
   */
  compressionLevel?: number;
  reconnect?: RelayReconnectOptions;
  onStatusChange?: (status: RelayStatus) => void;
  /** Called whenever the relay reports who has control. */
  onControlChange?: (control: SandboxDesktopControl) => void;
  /** Replace the default status line. Return null to show nothing. */
  renderStatus?: (status: RelayStatus, retry: () => void) => ReactNode;
  /** Replace the default take-over bar. Return null to show nothing. */
  renderControls?: (state: SandboxDesktopControlsState) => ReactNode;
};

const defaultQualityLevel = 6;
const defaultCompressionLevel = 2;

/** A level noVNC accepts: a whole number from 0 to 9. Anything else falls back to the default. */
function level(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(9, Math.max(0, Math.round(value)));
}

const rootStyle: CSSProperties = { position: "relative", width: "100%", height: "100%" };
const screenStyle: CSSProperties = { width: "100%", height: "100%" };

/**
 * A viewer for a remote sandbox's desktop, drawn with noVNC. noVNC is loaded on demand, so it costs
 * nothing until a desktop mounts. It connects to the hub's desktop relay, reconnects with a fresh
 * ticket when the link drops, and lets a person take over control from the agent.
 */
export const SandboxDesktop = forwardRef<SandboxDesktopHandle, SandboxDesktopProps>(
  function SandboxDesktop(
    {
      url,
      ticket,
      readOnly = false,
      scaleToFit = true,
      qualityLevel,
      compressionLevel,
      reconnect,
      onStatusChange,
      onControlChange,
      renderStatus,
      renderControls,
      style,
      ...rest
    },
    ref,
  ) {
    const screen = useRef<HTMLDivElement>(null);
    const connection = useRef<DesktopConnection | undefined>(undefined);
    const viewer = useRef<RFB | undefined>(undefined);
    const [status, setStatus] = useState<RelayStatus>({ state: "loading" });
    const [control, setControl] = useState<SandboxDesktopControl | undefined>(undefined);
    const [notice, setNotice] = useState<SandboxDesktopNotice | undefined>(undefined);

    // The viewer may send input unless it is read-only, or someone else holds control.
    const viewOnly =
      readOnly || control?.readOnly === true || (control?.held === true && !control.you);

    // The latest props, read by long-lived callbacks without restarting the connection.
    const latest = useRef({
      ticket,
      reconnect,
      onStatusChange,
      onControlChange,
      scaleToFit,
      viewOnly,
      quality: level(qualityLevel, defaultQualityLevel),
      compression: level(compressionLevel, defaultCompressionLevel),
    });
    latest.current = {
      ticket,
      reconnect,
      onStatusChange,
      onControlChange,
      scaleToFit,
      viewOnly,
      quality: level(qualityLevel, defaultQualityLevel),
      compression: level(compressionLevel, defaultCompressionLevel),
    };

    useImperativeHandle(
      ref,
      () => ({
        focus: () => viewer.current?.focus(),
        reconnect: () => connection.current?.retry(),
        takeOver: () => connection.current?.takeOver(),
        release: () => connection.current?.release(),
      }),
      [],
    );

    useEffect(() => {
      if (viewer.current !== undefined) viewer.current.viewOnly = viewOnly;
    }, [viewOnly]);
    useEffect(() => {
      if (viewer.current !== undefined) viewer.current.scaleViewport = scaleToFit;
    }, [scaleToFit]);
    useEffect(() => {
      if (viewer.current !== undefined) viewer.current.qualityLevel = latest.current.quality;
    }, [qualityLevel]);
    useEffect(() => {
      if (viewer.current !== undefined) {
        viewer.current.compressionLevel = latest.current.compression;
      }
    }, [compressionLevel]);

    useEffect(() => {
      const container = screen.current;
      if (container === null) return undefined;
      let disposed = false;
      let teardown: (() => void) | undefined;

      const publish = (next: RelayStatus) => {
        if (disposed) return;
        setStatus(next);
        // Who has control is unknown while the link is down.
        if (next.state !== "open") setControl(undefined);
        latest.current.onStatusChange?.(next);
      };
      publish({ state: "loading" });

      void (async () => {
        const { default: Rfb } = await import("@novnc/novnc");
        if (disposed) return;

        const link = new DesktopConnection({
          url,
          getTicket: resolveTicket(() => latest.current.ticket),
          reconnect: latest.current.reconnect,
          onStatus: publish,
          onChannel: (channel) => {
            // noVNC clients are single-use: each attachment gets a new one.
            viewer.current?.disconnect();
            const rfb = new Rfb(container, channel);
            rfb.scaleViewport = latest.current.scaleToFit;
            rfb.clipViewport = false;
            // The desktop's size is set through the hub's API, never by a viewer.
            rfb.resizeSession = false;
            rfb.viewOnly = latest.current.viewOnly;
            // Set outright, not left to noVNC's defaults, so what a viewer asks of the server is
            // stated here and can be changed.
            rfb.qualityLevel = latest.current.quality;
            rfb.compressionLevel = latest.current.compression;
            viewer.current = rfb;
          },
          onControl: (next) => {
            if (disposed) return;
            setControl(next);
            setNotice(undefined);
            latest.current.onControlChange?.(next);
          },
          onNotice: (next) => {
            if (!disposed) setNotice(next);
          },
        });
        connection.current = link;
        link.start();
        teardown = () => {
          link.dispose();
          viewer.current?.disconnect();
          viewer.current = undefined;
          connection.current = undefined;
        };
      })().catch((error: unknown) => {
        publish({
          state: "failed",
          message: error instanceof Error ? error.message : "Could not load the desktop viewer.",
        });
      });

      return () => {
        disposed = true;
        teardown?.();
      };
    }, [url]);

    const retry = () => connection.current?.retry();
    const takeOver = () => connection.current?.takeOver();
    const release = () => connection.current?.release();
    const statusNode =
      renderStatus === undefined ? (
        <DefaultStatus status={status} retry={retry} />
      ) : (
        renderStatus(status, retry)
      );
    const controlsState: SandboxDesktopControlsState = {
      status,
      control,
      readOnly: readOnly || control?.readOnly === true,
      notice,
      takeOver,
      release,
    };
    const controlsNode =
      renderControls === undefined ? (
        <DefaultControls {...controlsState} />
      ) : (
        renderControls(controlsState)
      );

    return (
      <div
        {...rest}
        data-state={status.state}
        data-readonly={viewOnly ? "" : undefined}
        data-control={control?.you === true ? "you" : control?.held === true ? "other" : "none"}
        style={{ ...rootStyle, ...style }}
      >
        <div ref={screen} style={screenStyle} />
        {controlsNode}
        {statusNode}
      </div>
    );
  },
);

const controlsStyle: CSSProperties = {
  position: "absolute",
  top: 8,
  left: 8,
  zIndex: 1,
  display: "flex",
  gap: 8,
  alignItems: "center",
  padding: "2px 8px",
  borderRadius: 4,
  fontSize: 12,
  background: "rgba(0, 0, 0, 0.7)",
  color: "#fff",
};

function DefaultControls({
  status,
  control,
  readOnly,
  notice,
  takeOver,
  release,
}: SandboxDesktopControlsState) {
  if (status.state !== "open" || control === undefined) return null;
  const who = control.you
    ? "You have control"
    : control.held
      ? `${control.holder ?? "Someone"} has control`
      : readOnly
        ? "View only"
        : "The agent has control";
  return (
    <div data-sandbox-desktop-controls="" style={controlsStyle}>
      <span>{who}</span>
      {control.you ? (
        <button type="button" onClick={release}>
          Release
        </button>
      ) : !readOnly && !control.held ? (
        <button type="button" onClick={takeOver}>
          Take over
        </button>
      ) : null}
      {notice === undefined ? null : <span role="alert">{notice.message}</span>}
    </div>
  );
}
