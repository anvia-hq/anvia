import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SandboxTerminal, type SandboxTerminalHandle } from "../src/sandbox-terminal";
import {
  FakeFit,
  FakeResizeObserver,
  FakeSocket,
  FakeXterm,
  resetSockets,
  resetTerminals,
} from "./sandbox-terminal-support";

vi.mock("@xterm/xterm", async () => {
  const support = await import("./sandbox-terminal-support");
  return { Terminal: support.FakeXterm };
});
vi.mock("@xterm/addon-fit", async () => {
  const support = await import("./sandbox-terminal-support");
  return { FitAddon: support.FakeFit };
});

beforeEach(() => {
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  resetSockets();
  resetTerminals();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const url = "wss://hub.example/terminal";

/** Mount and wait for the lazily loaded terminal to dial. */
async function mount(props: Partial<React.ComponentProps<typeof SandboxTerminal>> = {}) {
  const view = render(<SandboxTerminal url={url} data-testid="terminal" {...props} />);
  await waitFor(() => expect(FakeSocket.instances.length).toBeGreaterThan(0));
  return view;
}

const root = () => screen.getByTestId("terminal");

async function ready() {
  await act(async () => {
    FakeSocket.last.serverOpen();
    FakeSocket.last.serverMessage({ type: "ready" });
  });
}

describe("SandboxTerminal", () => {
  it("loads xterm on mount, connects, and shows the state until attached", async () => {
    render(<SandboxTerminal url={url} data-testid="terminal" />);
    expect(root().getAttribute("data-state")).toBe("loading");
    expect(screen.getByRole("status").textContent).toContain("Connecting");

    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    expect(FakeXterm.last.opened).toBeDefined();
    expect(FakeFit.fits).toBeGreaterThan(0);
    expect(FakeSocket.last.protocols).toEqual(["anvia.terminal.v1"]);

    await ready();
    expect(FakeSocket.last.sent).toEqual([{ type: "open", cols: 80, rows: 24 }]);
    expect(root().getAttribute("data-state")).toBe("open");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("writes output to the terminal and sends keystrokes", async () => {
    await mount();
    await ready();
    await act(async () => FakeSocket.last.serverOutput(new TextEncoder().encode("$ ")));
    expect(new TextDecoder().decode(FakeXterm.last.written[0])).toBe("$ ");

    FakeXterm.last.type("ls\r");
    expect(FakeSocket.last.sent.at(-1)).toEqual({ type: "input", data: "ls\r" });
  });

  it("sends the new size when the terminal is resized", async () => {
    await mount();
    await ready();
    FakeXterm.last.resize(132, 43);
    expect(FakeSocket.last.sent.at(-1)).toEqual({ type: "resize", cols: 132, rows: 43 });
  });

  it("refits when its container resizes", async () => {
    await mount();
    const fitsBefore = FakeFit.fits;
    await act(async () => {
      FakeResizeObserver.instances[0]?.trigger();
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    });
    expect(FakeFit.fits).toBeGreaterThan(fitsBefore);
  });

  it("takes no input when read-only", async () => {
    await mount({ readOnly: true });
    await ready();
    expect(FakeXterm.last.options.disableStdin).toBe(true);
    expect(root().hasAttribute("data-readonly")).toBe(true);

    FakeXterm.last.type("rm -rf /\r");
    FakeXterm.last.resize(10, 5);
    expect(FakeSocket.last.sent).toEqual([{ type: "open", cols: 80, rows: 24 }]);
  });

  it("reconnects after a drop and starts the reattached screen clean", async () => {
    // Long enough to observe the reconnecting state before the next attempt replaces it.
    await mount({ reconnect: { initialDelayMs: 150, maxDelayMs: 150 } });
    await ready();
    await act(async () => FakeSocket.last.serverClose());
    expect(root().getAttribute("data-state")).toBe("reconnecting");
    expect(screen.getByRole("status").textContent).toContain("Reconnecting");

    await waitFor(() => expect(FakeSocket.instances).toHaveLength(2));
    expect(FakeXterm.last.resets).toBe(0);
    await ready();
    expect(FakeXterm.last.resets).toBe(1);
    expect(root().getAttribute("data-state")).toBe("open");
  });

  it("asks for a fresh ticket on every connection", async () => {
    let issued = 0;
    await mount({ ticket: () => `t${(issued += 1)}`, reconnect: { initialDelayMs: 1 } });
    expect(FakeSocket.last.protocols).toEqual(["anvia.terminal.v1", "anvia.ticket.t1"]);
    await act(async () => FakeSocket.last.serverClose());
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(2));
    expect(FakeSocket.last.protocols).toEqual(["anvia.terminal.v1", "anvia.ticket.t2"]);
  });

  it("reports the end of the session and does not reconnect", async () => {
    await mount();
    await ready();
    await act(async () => {
      FakeSocket.last.serverMessage({ type: "exit", reason: "exited", exitCode: 3 });
      FakeSocket.last.serverClose();
    });
    expect(root().getAttribute("data-state")).toBe("ended");
    expect(screen.getByRole("status").textContent).toContain("Session ended (exit 3)");
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it("offers a retry after giving up", async () => {
    const ref = createRef<SandboxTerminalHandle>();
    await mount({ ref, reconnect: { maxAttempts: 0 } });
    await act(async () => FakeSocket.last.serverClose());
    expect(root().getAttribute("data-state")).toBe("failed");

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Retry" })));
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(2));

    await act(async () => FakeSocket.last.serverClose());
    await act(async () => ref.current?.reconnect());
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(3));
  });

  it("lets the app draw its own status", async () => {
    await mount({
      renderStatus: (status) => <p data-testid="custom">{status.state}</p>,
    });
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByTestId("custom").textContent).toBe("connecting");
  });

  it("reports status changes", async () => {
    const onStatusChange = vi.fn();
    await mount({ onStatusChange });
    await ready();
    expect(onStatusChange.mock.calls.map(([status]) => status.state)).toEqual([
      "loading",
      "connecting",
      "open",
    ]);
  });

  it("tears everything down on unmount, without reconnecting", async () => {
    const view = await mount({ reconnect: { initialDelayMs: 1 } });
    await ready();
    const socket = FakeSocket.last;
    const term = FakeXterm.last;
    view.unmount();

    expect(socket.closedWith).toBe(1000);
    expect(term.disposed).toBe(true);
    expect(FakeResizeObserver.instances[0]?.disconnected).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it("does not leak a terminal when unmounted before xterm loads", async () => {
    const view = render(<SandboxTerminal url={url} />);
    view.unmount();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(FakeSocket.instances).toHaveLength(0);
    expect(FakeXterm.instances.filter((term) => !term.disposed)).toEqual([]);
  });

  it("reconnects to the new endpoint when the URL changes", async () => {
    const view = await mount();
    const first = FakeSocket.last;
    view.rerender(<SandboxTerminal url="wss://other.example/terminal" data-testid="terminal" />);
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(2));
    expect(first.closedWith).toBe(1000);
    expect(FakeSocket.last.url).toContain("other.example");
  });
});
