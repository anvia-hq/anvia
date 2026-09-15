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

  describe("SSRF protection", () => {
    it("blocks localhost URLs even with allow-all-http policy", async () => {
      const { connection, command } = fakeConnection();
      const [navigate] = createBrowserTools({
        connection,
        tools: ["browser_navigate"],
        navigation: { mode: "allow-all-http" },
      });

      // Block localhost
      await expect(navigate?.call({ url: "http://localhost:8080" })).rejects.toMatchObject({
        code: "navigation_blocked",
      });

      // Block 127.0.0.1
      await expect(navigate?.call({ url: "http://127.0.0.1:3000" })).rejects.toMatchObject({
        code: "navigation_blocked",
      });

      // Block 127.x.x.x range
      await expect(navigate?.call({ url: "http://127.0.0.2" })).rejects.toMatchObject({
        code: "navigation_blocked",
      });

      expect(command).not.toHaveBeenCalledWith(
        expect.objectContaining({ method: "navigate" }),
        expect.anything(),
      );
    });

    it("blocks private IP ranges even with allow-all-http policy", async () => {
      const { connection, command } = fakeConnection();
      const [navigate] = createBrowserTools({
        connection,
        tools: ["browser_navigate"],
        navigation: { mode: "allow-all-http" },
      });

      // Block 10.0.0.0/8
      await expect(navigate?.call({ url: "http://10.0.0.1" })).rejects.toMatchObject({
        code: "navigation_blocked",
      });
      await expect(navigate?.call({ url: "http://10.255.255.255" })).rejects.toMatchObject({
        code: "navigation_blocked",
      });

      // Block 172.16.0.0/12
      await expect(navigate?.call({ url: "http://172.16.0.1" })).rejects.toMatchObject({
        code: "navigation_blocked",
      });
      await expect(navigate?.call({ url: "http://172.31.255.255" })).rejects.toMatchObject({
        code: "navigation_blocked",
      });

      // Block 192.168.0.0/16
      await expect(navigate?.call({ url: "http://192.168.1.1" })).rejects.toMatchObject({
        code: "navigation_blocked",
      });
      await expect(navigate?.call({ url: "http://192.168.255.255" })).rejects.toMatchObject({
        code: "navigation_blocked",
      });

      expect(command).not.toHaveBeenCalledWith(
        expect.objectContaining({ method: "navigate" }),
        expect.anything(),
      );
    });

    it("blocks link-local and reserved IP ranges", async () => {
      const { connection, command } = fakeConnection();
      const [navigate] = createBrowserTools({
        connection,
        tools: ["browser_navigate"],
        navigation: { mode: "allow-all-http" },
      });

      // Block 169.254.0.0/16 (link-local, AWS metadata)
      await expect(navigate?.call({ url: "http://169.254.169.254" })).rejects.toMatchObject({
        code: "navigation_blocked",
      });

      // Block 0.0.0.0/8
      await expect(navigate?.call({ url: "http://0.0.0.0" })).rejects.toMatchObject({
        code: "navigation_blocked",
      });

      expect(command).not.toHaveBeenCalledWith(
        expect.objectContaining({ method: "navigate" }),
        expect.anything(),
      );
    });

    it("blocks IPv6 loopback, link-local, and unique-local addresses", async () => {
      const { connection, command } = fakeConnection();
      const [navigate] = createBrowserTools({
        connection,
        tools: ["browser_navigate"],
        navigation: { mode: "allow-all-http" },
      });

      // Block ::1 (loopback)
      await expect(navigate?.call({ url: "http://[::1]" })).rejects.toMatchObject({
        code: "navigation_blocked",
      });

      // Block fe80::/10 link-local range
      await expect(navigate?.call({ url: "http://[fe80::1]" })).rejects.toMatchObject({
        code: "navigation_blocked",
      });
      await expect(navigate?.call({ url: "http://[fe90::1]" })).rejects.toMatchObject({
        code: "navigation_blocked",
      });
      await expect(navigate?.call({ url: "http://[febf::1]" })).rejects.toMatchObject({
        code: "navigation_blocked",
      });

      // Block fc00::/7 unique-local range
      await expect(navigate?.call({ url: "http://[fc00::1]" })).rejects.toMatchObject({
        code: "navigation_blocked",
      });
      await expect(navigate?.call({ url: "http://[fd00::1]" })).rejects.toMatchObject({
        code: "navigation_blocked",
      });

      // Block multicast ff00::/8
      await expect(navigate?.call({ url: "http://[ff02::1]" })).rejects.toMatchObject({
        code: "navigation_blocked",
      });

      expect(command).not.toHaveBeenCalledWith(
        expect.objectContaining({ method: "navigate" }),
        expect.anything(),
      );
    });

    it("blocks IPv4-mapped IPv6 addresses of blocked ranges", async () => {
      const { connection, command } = fakeConnection();
      const [navigate] = createBrowserTools({
        connection,
        tools: ["browser_navigate"],
        navigation: { mode: "allow-all-http" },
      });

      // ::ffff:127.0.0.1 = loopback
      await expect(navigate?.call({ url: "http://[::ffff:127.0.0.1]" })).rejects.toMatchObject({
        code: "navigation_blocked",
      });

      // ::ffff:10.0.0.1 = private
      await expect(navigate?.call({ url: "http://[::ffff:10.0.0.1]" })).rejects.toMatchObject({
        code: "navigation_blocked",
      });

      // ::ffff:192.168.1.1 = private
      await expect(navigate?.call({ url: "http://[::ffff:192.168.1.1]" })).rejects.toMatchObject({
        code: "navigation_blocked",
      });

      // ::ffff:169.254.169.254 = link-local (AWS metadata)
      await expect(
        navigate?.call({ url: "http://[::ffff:169.254.169.254]" }),
      ).rejects.toMatchObject({
        code: "navigation_blocked",
      });

      expect(command).not.toHaveBeenCalledWith(
        expect.objectContaining({ method: "navigate" }),
        expect.anything(),
      );
    });

    it("blocks response URL pointing to private IP after successful navigation", async () => {
      const { connection, command } = fakeConnection();
      const [navigate] = createBrowserTools({
        connection,
        tools: ["browser_navigate"],
        navigation: { mode: "allow-all-http" },
      });

      // Override the navigate handler to return a private-IP response URL
      command.mockImplementation(
        async (request: { method: string; params?: Record<string, unknown> }) => {
          if (request.method === "navigate") {
            return {
              tabId: "11111111-1111-4111-8111-111111111111",
              title: "Redirected",
              url: "http://127.0.0.1/admin",
            };
          }
          // Default: return standard listTabs response
          return [
            {
              id: "11111111-1111-4111-8111-111111111111",
              title: "Example",
              url: "https://example.com",
              selected: true,
            },
          ];
        },
      );

      // The tool-level assertNavigationAllowed(result.url) should block this
      await expect(
        navigate?.call({
          tabId: "11111111-1111-4111-8111-111111111111",
          url: "http://example.com",
        }),
      ).rejects.toMatchObject({
        code: "navigation_blocked",
      });
    });

    it("allows public IP addresses with allow-all-http policy", async () => {
      const { connection } = fakeConnection();
      const [navigate] = createBrowserTools({
        connection,
        tools: ["browser_navigate"],
        navigation: { mode: "allow-all-http" },
      });

      // Allow public IPs (these should NOT be blocked)
      const result1 = await navigate?.call({ url: "http://8.8.8.8" });
      expect(result1).toMatchObject({ url: "http://8.8.8.8" });

      const result2 = await navigate?.call({ url: "http://1.1.1.1" });
      expect(result2).toMatchObject({ url: "http://1.1.1.1" });
    });

    it("allows public domains with allow-all-http policy", async () => {
      const { connection } = fakeConnection();
      const [navigate] = createBrowserTools({
        connection,
        tools: ["browser_navigate"],
        navigation: { mode: "allow-all-http" },
      });

      // Allow public domains (these should NOT be blocked)
      const result1 = await navigate?.call({ url: "http://example.com" });
      expect(result1).toMatchObject({ url: "http://example.com" });

      const result2 = await navigate?.call({ url: "https://github.com" });
      expect(result2).toMatchObject({ url: "https://github.com" });
    });
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
  const command = vi.fn(
    async (request: { method: string; params?: Record<string, unknown> }, _options?: unknown) => {
      switch (request.method) {
        case "listTabs":
          return [{ id: tabId, title: "Example", url: "https://example.com", selected: true }];
        case "navigate":
          return {
            tabId,
            title: "Navigation Result",
            url: request.params?.url || "https://example.com",
          };
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
    },
  );
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
