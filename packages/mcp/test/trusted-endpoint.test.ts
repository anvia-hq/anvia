import { afterEach, expect, it, vi } from "vitest";
import { createTrustedEndpointFetch } from "../src/trusted-endpoint";
import { McpClient } from "../src";

const undici = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("undici", async (importOriginal) => ({
  ...(await importOriginal<typeof import("undici")>()),
  fetch: undici.fetch,
}));
afterEach(() => vi.clearAllMocks());

it.each([
  { headers: undefined, trustedAddresses: undefined, redirect: "manual" },
  { headers: {}, trustedAddresses: undefined, redirect: "error" },
  { headers: undefined, trustedAddresses: ["127.0.0.1"], redirect: "error" },
])(
  "uses the strict connection redirect policy: %j",
  async ({ headers, trustedAddresses, redirect }) => {
    const failure = new Error("stop before network I/O");
    undici.fetch.mockRejectedValue(failure);
    const client = new McpClient({
      name: "redirects",
      transport: {
        type: "streamableHttp",
        url: "https://editor.example/mcp",
        headers,
        trustedAddresses,
      },
    });
    try {
      await expect(client.connect()).rejects.toThrow(failure.message);
      expect(undici.fetch).toHaveBeenCalled();
      expect(undici.fetch.mock.calls[0]![1].redirect).toBe(redirect);
    } finally {
      await client.close();
    }
  },
);

it.each(["127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.0.1", "::1", "fd12::1", "93.184.216.34"])(
  "allows explicitly trusted address %s only for the exact endpoint",
  async (address) => {
    const endpoint = new URL("http://editor.invalid:3000/mcp");
    const trusted = createTrustedEndpointFetch(endpoint, [address]);
    undici.fetch.mockResolvedValue(new Response(null, { status: 204 }));
    try {
      await trusted.fetch(endpoint, { redirect: "follow" });
      const dispatcher = undici.fetch.mock.calls[0]![1].dispatcher;
      expect(undici.fetch.mock.calls[0]![1].redirect).toBe("error");
      await trusted.fetch("https://93.184.216.34/oauth");
      expect(undici.fetch.mock.calls[1]![1].dispatcher).not.toBe(dispatcher);
      expect(() => trusted.fetch("http://localhost:3000/oauth")).toThrow();
      expect(() => trusted.fetch("http://127.0.0.1:3000/mcp")).toThrow();
    } finally {
      await trusted.close();
    }
  },
);

it.each([
  "169.254.169.254",
  "169.254.1.2",
  "fd00:ec2::254",
  "FD00:0EC2:0:0:0:0:0:0254",
  "::ffff:127.0.0.1",
  "0.0.0.0",
  "224.0.0.1",
  "100.100.100.200",
  "fe80::1",
  "editor.invalid",
])("rejects metadata, reserved or nonliteral trusted addresses: %s", (address) => {
  expect(() =>
    createTrustedEndpointFetch(new URL("http://editor.invalid/mcp"), [address]),
  ).toThrow();
});

it("rejects empty pins, credential-bearing URLs, and an unpinned literal endpoint", () => {
  expect(() => createTrustedEndpointFetch(new URL("http://localhost/mcp"), [])).toThrow();
  expect(() =>
    createTrustedEndpointFetch(new URL("http://token@localhost/mcp"), ["127.0.0.1"]),
  ).toThrow();
  expect(() =>
    createTrustedEndpointFetch(new URL("http://127.0.0.2/mcp"), ["127.0.0.1"]),
  ).toThrow();
});

it("rejects case-insensitive duplicate headers before any HTTP request", async () => {
  const client = new McpClient({
    name: "headers",
    transport: {
      type: "streamableHttp",
      url: "http://localhost/mcp",
      trustedAddresses: ["127.0.0.1"],
      headers: { Authorization: "one", authorization: "two" },
    },
  });
  await expect(client.connect()).rejects.toThrow("Duplicate");
  expect(undici.fetch).not.toHaveBeenCalled();
  await client.close();
});
