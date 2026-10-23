import type { ITerminalOptions, Terminal } from "@xterm/xterm";
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
import { DefaultStatus } from "../relay/status";
import { type TicketSource, resolveTicket } from "../relay/ticket";
import {
  type SandboxTerminalReconnectOptions,
  type SandboxTerminalStatus,
  TerminalConnection,
} from "./connection";

export interface SandboxTerminalHandle {
  focus(): void;
  /** Reconnect now, after the terminal gave up. */
  reconnect(): void;
}

export type SandboxTerminalProps = Omit<PrimitiveProps<"div">, "children" | "onError"> & {
  /**
   * The hub's terminal endpoint (`hub.handleTerminalUpgrade`): `ws:`/`wss:`, `http:`/`https:`, or a
   * path relative to this page.
   */
  url: string;
  /** Sent as `?session=` so your `authorizeTerminal` can choose the session. The server decides. */
  sessionName?: string;
  /**
   * A one-time ticket, or a function returning one. Pass a function: tickets are single use, so
   * each reconnect needs a fresh one. It travels as a WebSocket subprotocol, not in the URL.
   */
  ticket?: TicketSource;
  /** Show output only. The server enforces it too; this also stops the terminal taking input. */
  readOnly?: boolean;
  reconnect?: SandboxTerminalReconnectOptions;
  /** xterm options, such as `fontSize` or `theme`. Applied when the terminal is created. */
  terminalOptions?: ITerminalOptions;
  onStatusChange?: (status: SandboxTerminalStatus) => void;
  /** Replace the default status line. Return null to show nothing. */
  renderStatus?: (status: SandboxTerminalStatus, retry: () => void) => ReactNode;
};

const rootStyle: CSSProperties = { position: "relative", width: "100%", height: "100%" };
const screenStyle: CSSProperties = { width: "100%", height: "100%" };

/**
 * A terminal for a remote sandbox session, drawn with xterm.js. xterm is loaded on demand, so it
 * costs nothing until a terminal mounts. Import `@xterm/xterm/css/xterm.css` once in your app.
 */
export const SandboxTerminal = forwardRef<SandboxTerminalHandle, SandboxTerminalProps>(
  function SandboxTerminal(
    {
      url,
      sessionName,
      ticket,
      readOnly = false,
      reconnect,
      terminalOptions,
      onStatusChange,
      renderStatus,
      style,
      ...rest
    },
    ref,
  ) {
    const screen = useRef<HTMLDivElement>(null);
    const connection = useRef<TerminalConnection | undefined>(undefined);
    const terminal = useRef<Terminal | undefined>(undefined);
    const [status, setStatus] = useState<SandboxTerminalStatus>({ state: "loading" });

    // The latest props, read by long-lived callbacks without restarting the terminal.
    const latest = useRef({ ticket, reconnect, terminalOptions, onStatusChange });
    latest.current = { ticket, reconnect, terminalOptions, onStatusChange };

    useImperativeHandle(
      ref,
      () => ({
        focus: () => terminal.current?.focus(),
        reconnect: () => connection.current?.retry(),
      }),
      [],
    );

    useEffect(() => {
      const container = screen.current;
      if (container === null) return undefined;
      let disposed = false;
      let teardown: (() => void) | undefined;

      const publish = (next: SandboxTerminalStatus) => {
        if (disposed) return;
        setStatus(next);
        latest.current.onStatusChange?.(next);
      };
      publish({ state: "loading" });

      void (async () => {
        const [{ Terminal: XTerm }, { FitAddon }] = await Promise.all([
          import("@xterm/xterm"),
          import("@xterm/addon-fit"),
        ]);
        if (disposed) return;

        const xterm = new XTerm({
          cursorBlink: !readOnly,
          disableStdin: readOnly,
          scrollback: 5_000,
          ...latest.current.terminalOptions,
        });
        const fit = new FitAddon();
        xterm.loadAddon(fit);
        xterm.open(container);
        fit.fit();
        terminal.current = xterm;

        const link = new TerminalConnection({
          url,
          sessionName,
          getTicket: resolveTicket(() => latest.current.ticket),
          size: () => ({ cols: xterm.cols, rows: xterm.rows }),
          onOutput: (bytes) => xterm.write(bytes),
          // The hub redraws the session on every attach, so start from a clean screen.
          onOpen: (reconnected) => {
            if (reconnected) xterm.reset();
            if (!readOnly) xterm.focus();
          },
          onStatus: publish,
          reconnect: latest.current.reconnect,
        });
        connection.current = link;

        const input = xterm.onData((data) => {
          if (!readOnly) link.sendInput(data);
        });
        const resized = xterm.onResize(({ cols, rows }) => {
          if (!readOnly) link.sendResize(cols, rows);
        });
        let frame = 0;
        const observer = new ResizeObserver(() => {
          cancelAnimationFrame(frame);
          frame = requestAnimationFrame(() => fit.fit());
        });
        observer.observe(container);

        link.start();
        teardown = () => {
          cancelAnimationFrame(frame);
          observer.disconnect();
          input.dispose();
          resized.dispose();
          link.dispose();
          xterm.dispose();
          connection.current = undefined;
          terminal.current = undefined;
        };
      })().catch((error: unknown) => {
        publish({
          state: "failed",
          message: error instanceof Error ? error.message : "Could not load the terminal.",
        });
      });

      return () => {
        disposed = true;
        teardown?.();
      };
    }, [url, sessionName, readOnly]);

    const retry = () => connection.current?.retry();
    const statusNode =
      renderStatus === undefined ? (
        <DefaultStatus status={status} retry={retry} />
      ) : (
        renderStatus(status, retry)
      );

    return (
      <div
        {...rest}
        data-state={status.state}
        data-readonly={readOnly ? "" : undefined}
        style={{ ...rootStyle, ...style }}
      >
        <div ref={screen} style={screenStyle} />
        {statusNode}
      </div>
    );
  },
);
