// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StudioBrowserView } from "../src/ui/app/modules/sandboxes/browser-view";

const noVnc = vi.hoisted(() => ({
  constructions: vi.fn(),
  disconnects: vi.fn(),
}));

vi.mock("@novnc/novnc", () => ({
  default: class FakeRfb extends EventTarget {
    scaleViewport = false;
    resizeSession = false;
    viewOnly = false;
    background = "";

    constructor(target: HTMLElement, url: string, options: unknown) {
      super();
      noVnc.constructions(target, url, options, this);
      queueMicrotask(() => this.dispatchEvent(new Event("connect")));
    }

    disconnect() {
      noVnc.disconnects();
    }

    sendCredentials() {}
  },
}));

describe("StudioBrowserView", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith("/control")) return jsonResponse({ mode: "agent" });
        if (url.endsWith("/connection")) {
          return jsonResponse({
            sandboxRef: "sandbox_ref",
            viewId: "desktop",
            protocol: "novnc",
            websocketPath: "/sandboxes/sandbox_ref/views/desktop/ws",
            authentication: { type: "password", password: "private-password" },
          });
        }
        return new Response(null, { status: 404 });
      }),
    );
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    noVnc.constructions.mockClear();
    noVnc.disconnects.mockClear();
    vi.unstubAllGlobals();
  });

  it("connects noVNC directly with Studio-owned credentials and renders no stock shell", async () => {
    act(() =>
      root.render(
        <StudioBrowserView
          sandboxRef="sandbox_ref"
          view={{ id: "desktop", label: "Browser", protocol: "novnc" }}
          onError={vi.fn()}
        />,
      ),
    );

    await act(async () => {
      await vi.waitFor(() => expect(noVnc.constructions).toHaveBeenCalledOnce());
    });
    expect(noVnc.constructions.mock.calls[0]?.[1]).toBe(
      "ws://localhost:3000/sandboxes/sandbox_ref/views/desktop/ws",
    );
    expect(noVnc.constructions.mock.calls[0]?.[2]).toEqual({
      credentials: { username: "", password: "private-password", target: "" },
    });
    expect(container.textContent).toContain("Agent control");
    expect(container.textContent).not.toContain("private-password");
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.querySelector("#noVNC_control_bar_anchor")).toBeNull();

    act(() =>
      root.render(
        <StudioBrowserView
          sandboxRef="sandbox_ref"
          view={{ id: "desktop", label: "Browser", protocol: "novnc" }}
          onError={vi.fn()}
        />,
      ),
    );
    expect(noVnc.constructions).toHaveBeenCalledOnce();
    expect(noVnc.disconnects).not.toHaveBeenCalled();
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  });
}
