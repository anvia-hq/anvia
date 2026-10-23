import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SandboxDesktop, type SandboxDesktopHandle } from "../src/sandbox-desktop";
import { FakeRfb, resetRfb } from "./sandbox-desktop-support";
import { FakeSocket, resetSockets } from "./sandbox-terminal-support";

vi.mock("@novnc/novnc", async () => {
  const support = await import("./sandbox-desktop-support");
  return { default: support.FakeRfb };
});

beforeEach(() => {
  vi.stubGlobal("WebSocket", FakeSocket);
  resetSockets();
  resetRfb();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const url = "wss://hub.example/desktop";
const banner = new TextEncoder().encode("RFB 003.008\n");

async function mount(props: Partial<React.ComponentProps<typeof SandboxDesktop>> = {}) {
  const view = render(<SandboxDesktop url={url} data-testid="desktop" {...props} />);
  await waitFor(() => expect(FakeSocket.instances.length).toBeGreaterThan(0));
  return view;
}

const root = () => screen.getByTestId("desktop");
const control = (extra: Record<string, unknown> = {}) => ({
  type: "control",
  held: false,
  you: false,
  readOnly: false,
  ...extra,
});

/** The relay accepts the viewer: the socket opens and the VNC server's banner arrives. */
async function accepted() {
  await act(async () => {
    FakeSocket.last.serverOpen();
    FakeSocket.last.serverOutput(banner);
  });
}

describe("SandboxDesktop", () => {
  it("loads noVNC on mount, connects, and attaches a client once the relay answers", async () => {
    render(<SandboxDesktop url={url} data-testid="desktop" />);
    expect(root().getAttribute("data-state")).toBe("loading");
    expect(screen.getByRole("status").textContent).toContain("Connecting");

    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    expect(FakeSocket.last.protocols).toEqual(["anvia.desktop.v1"]);
    expect(FakeRfb.instances).toHaveLength(0);

    await accepted();
    expect(root().getAttribute("data-state")).toBe("open");
    expect(screen.queryByRole("status")).toBeNull();
    expect(FakeRfb.instances).toHaveLength(1);
    expect(FakeRfb.last.target).toBeInstanceOf(HTMLElement);
    // The desktop is fitted to the element, and only the hub's API ever resizes it.
    expect(FakeRfb.last).toMatchObject({
      scaleViewport: true,
      clipViewport: false,
      resizeSession: false,
    });
  });

  it("gives noVNC the VNC bytes the server sent before the client attached", async () => {
    await mount();
    await accepted();
    expect(new Uint8Array(FakeRfb.last.received[0] ?? new ArrayBuffer(0))).toEqual(banner);

    await act(async () => FakeSocket.last.serverOutput(new Uint8Array([1, 2, 3])));
    expect(FakeRfb.last.received).toHaveLength(2);
  });

  it("sends the client's bytes to the relay, and keeps JSON control frames away from it", async () => {
    await mount();
    await accepted();
    FakeRfb.last.channel.send(new Uint8Array([5, 1, 0, 10, 0, 20]));
    expect(FakeSocket.last.sentBinary).toHaveLength(1);

    await act(async () => FakeSocket.last.serverMessage(control()));
    expect(FakeRfb.last.received).toHaveLength(1); // Only the banner reached noVNC.
  });

  it("scales to fit by default, and follows the prop", async () => {
    const view = await mount({ scaleToFit: false });
    await accepted();
    expect(FakeRfb.last.scaleViewport).toBe(false);
    view.rerender(<SandboxDesktop url={url} data-testid="desktop" scaleToFit />);
    expect(FakeRfb.last.scaleViewport).toBe(true);
  });

  describe("picture quality", () => {
    it("states the quality and compression it asks of the server, not left to noVNC", async () => {
      await mount();
      await accepted();
      expect(FakeRfb.last).toMatchObject({ qualityLevel: 6, compressionLevel: 2 });
    });

    it("takes both as props, and applies a change to the live connection", async () => {
      const view = await mount({ qualityLevel: 3, compressionLevel: 8 });
      await accepted();
      expect(FakeRfb.last).toMatchObject({ qualityLevel: 3, compressionLevel: 8 });

      view.rerender(
        <SandboxDesktop url={url} data-testid="desktop" qualityLevel={9} compressionLevel={0} />,
      );
      expect(FakeRfb.last).toMatchObject({ qualityLevel: 9, compressionLevel: 0 });
      expect(FakeRfb.instances).toHaveLength(1); // The connection was not restarted for it.
    });

    it("rounds and clamps levels noVNC would refuse, and ignores nonsense", async () => {
      const view = await mount({ qualityLevel: 12.4, compressionLevel: -3 });
      await accepted();
      expect(FakeRfb.last).toMatchObject({ qualityLevel: 9, compressionLevel: 0 });

      view.rerender(
        <SandboxDesktop
          url={url}
          data-testid="desktop"
          qualityLevel={Number.NaN}
          compressionLevel={4.6}
        />,
      );
      expect(FakeRfb.last).toMatchObject({ qualityLevel: 6, compressionLevel: 5 });
    });

    it("gives a reconnected client the same levels", async () => {
      await mount({ qualityLevel: 2, compressionLevel: 7 });
      await accepted();
      await act(async () => FakeSocket.last.serverClose());
      await waitFor(() => expect(FakeSocket.instances.length).toBeGreaterThan(1));
      await accepted();
      expect(FakeRfb.instances.length).toBeGreaterThan(1);
      expect(FakeRfb.last).toMatchObject({ qualityLevel: 2, compressionLevel: 7 });
    });
  });

  describe("taking control", () => {
    it("shows who has control and lets the viewer take over and release", async () => {
      await mount();
      await accepted();
      await act(async () => FakeSocket.last.serverMessage(control()));
      expect(screen.getByText("The agent has control")).toBeTruthy();
      expect(root().getAttribute("data-control")).toBe("none");

      fireEvent.click(screen.getByRole("button", { name: "Take over" }));
      expect(FakeSocket.last.sent.at(-1)).toEqual({ type: "takeover" });

      await act(async () =>
        FakeSocket.last.serverMessage(control({ held: true, you: true, holder: "alice" })),
      );
      expect(screen.getByText("You have control")).toBeTruthy();
      expect(root().getAttribute("data-control")).toBe("you");
      expect(FakeRfb.last.viewOnly).toBe(false);

      fireEvent.click(screen.getByRole("button", { name: "Release" }));
      expect(FakeSocket.last.sent.at(-1)).toEqual({ type: "release" });
    });

    it("mutes the viewer while someone else has control, without offering a take-over", async () => {
      await mount();
      await accepted();
      await act(async () =>
        FakeSocket.last.serverMessage(control({ held: true, holder: "bob", you: false })),
      );
      expect(screen.getByText("bob has control")).toBeTruthy();
      expect(screen.queryByRole("button")).toBeNull();
      expect(FakeRfb.last.viewOnly).toBe(true);
      expect(root().getAttribute("data-control")).toBe("other");

      // Control frees up, and the viewer may type again.
      await act(async () => FakeSocket.last.serverMessage(control()));
      expect(FakeRfb.last.viewOnly).toBe(false);
    });

    it("surfaces a refused request and clears it on the next update", async () => {
      await mount();
      await accepted();
      await act(async () => FakeSocket.last.serverMessage(control()));
      await act(async () =>
        FakeSocket.last.serverMessage({
          type: "error",
          code: "desktop_locked",
          message: "The desktop is controlled by bob.",
        }),
      );
      expect(screen.getByRole("alert").textContent).toBe("The desktop is controlled by bob.");
      await act(async () => FakeSocket.last.serverMessage(control()));
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("reports control changes, and exposes take over and release on a ref", async () => {
      const onControlChange = vi.fn();
      const ref = createRef<SandboxDesktopHandle>();
      await mount({ onControlChange, ref });
      await accepted();
      await act(async () => FakeSocket.last.serverMessage(control({ held: true, holder: "x" })));
      expect(onControlChange).toHaveBeenCalledWith({
        held: true,
        holder: "x",
        you: false,
        readOnly: false,
      });

      ref.current?.takeOver();
      ref.current?.release();
      expect(FakeSocket.last.sent.slice(-2)).toEqual([{ type: "takeover" }, { type: "release" }]);
      ref.current?.focus();
      expect(FakeRfb.last.focused).toBe(1);
    });
  });

  describe("read-only", () => {
    it("takes no input and offers no way to take control, whichever side says so", async () => {
      await mount({ readOnly: true });
      await accepted();
      expect(FakeRfb.last.viewOnly).toBe(true);
      expect(root().hasAttribute("data-readonly")).toBe(true);
      await act(async () => FakeSocket.last.serverMessage(control({ readOnly: false })));
      expect(screen.getByText("View only")).toBeTruthy();
      expect(screen.queryByRole("button")).toBeNull();
    });

    it("follows a ticket the relay marked read-only, even without the prop", async () => {
      await mount();
      await accepted();
      await act(async () => FakeSocket.last.serverMessage(control({ readOnly: true })));
      expect(FakeRfb.last.viewOnly).toBe(true);
      expect(screen.queryByRole("button")).toBeNull();
    });
  });

  describe("reconnecting", () => {
    it("reattaches a fresh client after a drop, with a fresh ticket", async () => {
      let issued = 0;
      await mount({ ticket: () => `t${(issued += 1)}`, reconnect: { initialDelayMs: 150 } });
      await accepted();
      const first = FakeRfb.last;
      expect(FakeSocket.last.protocols).toEqual(["anvia.desktop.v1", "anvia.ticket.t1"]);

      await act(async () => FakeSocket.last.serverClose());
      expect(root().getAttribute("data-state")).toBe("reconnecting");
      expect(screen.getByRole("status").textContent).toContain("Reconnecting");

      await waitFor(() => expect(FakeSocket.instances).toHaveLength(2));
      expect(FakeSocket.last.protocols).toEqual(["anvia.desktop.v1", "anvia.ticket.t2"]);
      await accepted();
      expect(FakeRfb.instances).toHaveLength(2);
      expect(FakeRfb.last).not.toBe(first);
      expect(first.disconnected).toBe(true);
      expect(root().getAttribute("data-state")).toBe("open");
    });

    it("forgets who had control while the link is down", async () => {
      await mount({ reconnect: { initialDelayMs: 150 } });
      await accepted();
      await act(async () => FakeSocket.last.serverMessage(control({ held: true, holder: "bob" })));
      expect(screen.getByText("bob has control")).toBeTruthy();
      await act(async () => FakeSocket.last.serverClose());
      expect(screen.queryByText("bob has control")).toBeNull();
    });

    it("stops for a reason retrying cannot fix, and retries one that may clear up", async () => {
      await mount({ reconnect: { initialDelayMs: 150 } });
      await act(async () => {
        FakeSocket.last.serverOpen();
        FakeSocket.last.serverClose(1011, "unsupported: Sandbox sb does not support a desktop.");
      });
      expect(root().getAttribute("data-state")).toBe("failed");
      expect(screen.getByRole("status").textContent).toContain("does not support a desktop");
      expect(FakeSocket.instances).toHaveLength(1);

      cleanup();
      resetSockets();
      await mount({ reconnect: { initialDelayMs: 150 } });
      await act(async () => {
        FakeSocket.last.serverOpen();
        FakeSocket.last.serverClose(1011, "sandbox_unavailable: Sandbox sb is unavailable.");
      });
      expect(root().getAttribute("data-state")).toBe("reconnecting");
    });

    it("gives up when the relay refuses what the viewer sent", async () => {
      await mount();
      await act(async () => {
        FakeSocket.last.serverOpen();
        FakeSocket.last.serverClose(1008, "Unsupported RFB message type 99.");
      });
      expect(root().getAttribute("data-state")).toBe("failed");
      expect(screen.getByRole("status").textContent).toContain("Unsupported RFB message");
    });

    it("offers a retry after giving up", async () => {
      const ref = createRef<SandboxDesktopHandle>();
      await mount({ ref, reconnect: { maxAttempts: 0 } });
      await act(async () => FakeSocket.last.serverClose());
      expect(root().getAttribute("data-state")).toBe("failed");
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "Retry" })));
      await waitFor(() => expect(FakeSocket.instances).toHaveLength(2));
      await act(async () => FakeSocket.last.serverClose());
      await act(async () => ref.current?.reconnect());
      await waitFor(() => expect(FakeSocket.instances).toHaveLength(3));
    });

    it("reconnects to the new endpoint when the URL changes", async () => {
      const view = await mount();
      await accepted();
      const first = FakeSocket.last;
      const client = FakeRfb.last;
      view.rerender(<SandboxDesktop url="wss://other.example/desktop" data-testid="desktop" />);
      await waitFor(() => expect(FakeSocket.instances).toHaveLength(2));
      expect(first.closedWith).toBe(1000);
      expect(client.disconnected).toBe(true);
      expect(FakeSocket.last.url).toContain("other.example");
    });
  });

  describe("customising", () => {
    it("lets the app draw its own status and controls", async () => {
      await mount({
        renderStatus: (status) => <p data-testid="custom-status">{status.state}</p>,
        renderControls: ({ control: state }) => (
          <p data-testid="custom-controls">{state?.held ? "held" : "free"}</p>
        ),
      });
      expect(screen.queryByRole("status")).toBeNull();
      expect(screen.getByTestId("custom-status").textContent).toBe("connecting");
      await accepted();
      await act(async () => FakeSocket.last.serverMessage(control()));
      expect(screen.getByTestId("custom-controls").textContent).toBe("free");
    });

    it("reports status changes", async () => {
      const onStatusChange = vi.fn();
      await mount({ onStatusChange });
      await accepted();
      expect(onStatusChange.mock.calls.map(([status]) => status.state)).toEqual([
        "loading",
        "connecting",
        "open",
      ]);
    });
  });

  describe("unmounting", () => {
    it("tears everything down, without reconnecting", async () => {
      const view = await mount({ reconnect: { initialDelayMs: 1 } });
      await accepted();
      const socket = FakeSocket.last;
      const client = FakeRfb.last;
      view.unmount();

      expect(socket.closedWith).toBe(1000);
      expect(client.disconnected).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(FakeSocket.instances).toHaveLength(1);
    });

    it("does not connect if unmounted before noVNC loads", async () => {
      const view = render(<SandboxDesktop url={url} />);
      view.unmount();
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(FakeSocket.instances).toHaveLength(0);
      expect(FakeRfb.instances).toHaveLength(0);
    });
  });
});
