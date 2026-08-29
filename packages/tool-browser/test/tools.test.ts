import { describe, expect, it, vi } from "vitest";
import { type AutomationBackend, PlaywrightBrowserConnectionImpl } from "../src/connection";
import { BrowserControlState } from "../src/control";
import { createBrowserTools } from "../src/tools";

describe("createBrowserTools", () => {
  it("requires an explicit, unique tool selection and navigation policy", () => {
    const connection = fakeConnection().connection;
    expect(() => createBrowserTools({ connection, tools: [] } as never)).toThrow("non-empty");
    expect(() =>
      createBrowserTools({
        connection,
        tools: ["browser_snapshot", "browser_snapshot"],
        navigation: { mode: "allow-all-http" },
      }),
    ).toThrow("duplicate");
    expect(() =>
      createBrowserTools({
        connection,
        tools: ["browser_snapshot"],
        navigation: { mode: "origins", origins: [] },
      }),
    ).toThrow("non-empty origin");
  });

  it("blocks non-HTTP navigation before Playwright receives it", async () => {
    const { connection, command } = fakeConnection();
    const [navigate] = createBrowserTools({
      connection,
      tools: ["browser_navigate"],
      navigation: { mode: "allow-all-http" },
    });
    await expect(navigate?.call({ url: "file:///etc/passwd" })).rejects.toMatchObject({
      code: "navigation_blocked",
    });
    expect(command).not.toHaveBeenCalledWith(
      expect.objectContaining({ method: "navigate" }),
      expect.anything(),
    );
  });

  it("reports navigation policy rejection from redirects as navigation_blocked", async () => {
    const { connection, command } = fakeConnection();
    const [navigate] = createBrowserTools({
      connection,
      tools: ["browser_navigate"],
      navigation: { mode: "origins", origins: ["https://example.com"] },
    });
    await connection.listTabs();
    command.mockRejectedValueOnce(new Error("page.goto: net::ERR_BLOCKED_BY_CLIENT"));

    await expect(
      navigate?.call({
        tabId: "11111111-1111-4111-8111-111111111111",
        url: "https://example.com/redirect",
      }),
    ).rejects.toMatchObject({ code: "navigation_blocked" });
  });

  it("installs the navigation policy before browser interaction", async () => {
    const { connection, command } = fakeConnection();
    const [snapshot] = createBrowserTools({
      connection,
      tools: ["browser_snapshot"],
      navigation: { mode: "origins", origins: ["https://example.com"] },
    });
    await snapshot?.call({});

    expect(command.mock.calls[0]?.[0]).toEqual({
      method: "setNavigationPolicy",
      params: { policy: { mode: "origins", origins: ["https://example.com"] } },
    });
    expect(command.mock.calls[0]?.[1]).toEqual(expect.anything());
  });

  it("returns native structured PNG output", async () => {
    const { connection } = fakeConnection();
    const [screenshot] = createBrowserTools({
      connection,
      tools: ["browser_screenshot"],
      navigation: { mode: "allow-all-http" },
    });
    const output = await screenshot?.call({});
    expect(output).toMatchObject({
      content: [
        { type: "text" },
        { type: "file", mediaType: "image/png", filename: "browser-screenshot.png" },
      ],
    });
  });

  it("rejects agent tools while Studio holds human control", async () => {
    const control = new BrowserControlState();
    const { connection } = fakeConnection(control);
    const [snapshot] = createBrowserTools({
      connection,
      tools: ["browser_snapshot"],
      navigation: { mode: "allow-all-http" },
    });
    const lease = await control.acquireHumanControl({ ownerId: "viewer", leaseTimeoutMs: 30_000 });
    await expect(snapshot?.call({})).rejects.toMatchObject({ code: "human_controlled" });
    lease.release();
  });
});

function fakeConnection(control = new BrowserControlState()) {
  const tabId = "11111111-1111-4111-8111-111111111111";
  const command = vi.fn(async (request: { method: string }, _options?: unknown) => {
    switch (request.method) {
      case "listTabs":
        return [{ id: tabId, title: "Example", url: "https://example.com", selected: true }];
      case "snapshot":
        return {
          tabId,
          title: "Example",
          url: "https://example.com",
          snapshot: "- document",
          truncated: false,
        };
      case "screenshot":
        return {
          metadata: { tabId, title: "Example", url: "https://example.com" },
          pngBase64: Buffer.from("png").toString("base64"),
        };
      default:
        return undefined;
    }
  });
  const backend: AutomationBackend = {
    closed: false,
    command: async <T>(
      request: Parameters<AutomationBackend["command"]>[0],
      options: Parameters<AutomationBackend["command"]>[1],
    ) => command(request, options) as Promise<T>,
    disconnect: vi.fn(),
    onDisconnected: vi.fn(() => () => undefined),
  };
  return {
    command,
    connection: new PlaywrightBrowserConnectionImpl({ backend, control }),
  };
}
