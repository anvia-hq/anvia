import { describe, expect, it, vi } from "vitest";
import { PlaywrightBrowserConnectionImpl } from "../src/connection";
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
    const { connection, page } = fakeConnection();
    const [navigate] = createBrowserTools({
      connection,
      tools: ["browser_navigate"],
      navigation: { mode: "allow-all-http" },
    });
    await expect(navigate?.call({ url: "file:///etc/passwd" })).rejects.toMatchObject({
      code: "navigation_blocked",
    });
    expect(page.goto).not.toHaveBeenCalled();
  });

  it("guards top-level navigation caused by any browser interaction", async () => {
    const { connection, context } = fakeConnection();
    const [snapshot] = createBrowserTools({
      connection,
      tools: ["browser_snapshot"],
      navigation: { mode: "origins", origins: ["https://example.com"] },
    });
    await snapshot?.call({});

    const handler = context.route.mock.calls[0]?.[1] as
      | ((route: unknown) => Promise<void>)
      | undefined;
    expect(handler).toBeTypeOf("function");
    const frame = { page: () => ({ mainFrame: () => frame }) };
    const route = {
      request: () => ({
        isNavigationRequest: () => true,
        frame: () => frame,
        url: () => "http://127.0.0.1/private",
      }),
      abort: vi.fn(),
      continue: vi.fn(),
    };
    await handler?.(route);
    expect(route.abort).toHaveBeenCalledWith("blockedbyclient");
    expect(route.continue).not.toHaveBeenCalled();
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
  const locator = {
    ariaSnapshot: vi.fn(async () => "- document"),
    click: vi.fn(),
    fill: vi.fn(),
  };
  const page = {
    title: vi.fn(async () => "Example"),
    url: vi.fn(() => "https://example.com"),
    isClosed: vi.fn(() => false),
    locator: vi.fn(() => locator),
    getByRole: vi.fn(() => locator),
    getByText: vi.fn(() => locator),
    getByLabel: vi.fn(() => locator),
    getByPlaceholder: vi.fn(() => locator),
    getByTestId: vi.fn(() => locator),
    screenshot: vi.fn(async () => Buffer.from("png")),
    goto: vi.fn(),
    route: vi.fn(),
    unroute: vi.fn(),
    mainFrame: vi.fn(() => ({})),
    keyboard: { press: vi.fn() },
    close: vi.fn(),
  };
  const context = {
    pages: vi.fn(() => [page]),
    newPage: vi.fn(async () => page),
    route: vi.fn(async (_pattern: string, _handler: unknown) => undefined),
  };
  const browser = {
    contexts: vi.fn(() => [context]),
    once: vi.fn(),
    isConnected: vi.fn(() => true),
    close: vi.fn(),
  };
  return {
    page,
    context,
    connection: new PlaywrightBrowserConnectionImpl(browser as never, control),
  };
}
