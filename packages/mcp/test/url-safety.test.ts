import type { LookupAddress } from "node:dns";
import type { LookupFunction } from "node:net";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSafeMcpFetch,
  createSafeMcpLookup,
  parseAndValidateMcpUrl,
  resolveAndValidateMcpHostname,
} from "../src/url-safety.js";

const undici = vi.hoisted(() => ({
  fetch: vi.fn(),
}));

vi.mock("undici", async (importOriginal) => {
  const actual = await importOriginal<typeof import("undici")>();
  return {
    ...actual,
    fetch: undici.fetch,
  };
});

describe("MCP connection SSRF protection", () => {
  describe("URL validation", () => {
    it.each(["https://api.example.com/mcp", "http://93.184.216.34/mcp"])(
      "allows public HTTP(S) URL %s",
      (url) => {
        expect(parseAndValidateMcpUrl(url).href).toBe(url);
      },
    );

    it.each([
      ["http://localhost:3000/mcp", "localhost not allowed"],
      ["http://localhost.:3000/mcp", "localhost not allowed"],
      ["http://server.localhost/mcp", "localhost not allowed"],
      ["http://127.1.2.3/mcp", "localhost not allowed"],
      ["http://10.0.0.1/mcp", "private IP range not allowed"],
      ["http://100.100.100.200/mcp", "private IP range not allowed"],
      ["http://169.254.169.254/latest/meta-data", "cloud metadata endpoint not allowed"],
      ["http://192.168.1.1/mcp", "private IP range not allowed"],
      ["http://[::]/mcp", "private IPv6 range not allowed"],
      ["http://[::1]/mcp", "localhost not allowed"],
      ["http://[::ffff:127.0.0.1]/mcp", "private IPv6 range not allowed"],
      ["http://[fd12::1]/mcp", "private IPv6 range not allowed"],
      ["http://[fe90::1]/mcp", "private IPv6 range not allowed"],
      ["http://[fd00:ec2::254]/mcp", "cloud metadata endpoint not allowed"],
    ])("blocks non-public URL %s", (url, message) => {
      expect(() => parseAndValidateMcpUrl(url)).toThrow(message);
    });

    it.each(["file:///etc/passwd", "ftp://api.example.com/mcp", "not-a-url"])(
      "rejects unsupported or malformed URL %s",
      (url) => {
        expect(() => parseAndValidateMcpUrl(url)).toThrow();
      },
    );
  });

  describe("DNS validation", () => {
    it("allows and returns public DNS results for connection pinning", async () => {
      const addresses: LookupAddress[] = [
        { address: "93.184.216.34", family: 4 },
        { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
      ];
      const resolver = vi.fn(async () => addresses);

      await expect(resolveAndValidateMcpHostname("API.EXAMPLE.COM.", resolver)).resolves.toEqual(
        addresses,
      );
      expect(resolver).toHaveBeenCalledWith("api.example.com");
    });

    it("rejects a hostname when any DNS result is non-public", async () => {
      const resolver = vi.fn(async () => [
        { address: "93.184.216.34", family: 4 as const },
        { address: "10.0.0.1", family: 4 as const },
      ]);

      await expect(resolveAndValidateMcpHostname("attacker.example", resolver)).rejects.toThrow(
        "private IP range not allowed",
      );
    });

    it("rejects hostnames that resolve to IPv4-mapped loopback", async () => {
      const resolver = vi.fn(async () => [{ address: "::ffff:127.0.0.1", family: 6 as const }]);

      await expect(resolveAndValidateMcpHostname("attacker.example", resolver)).rejects.toThrow(
        "private IPv6 range not allowed",
      );
    });

    it("returns the validated DNS results from the socket lookup", async () => {
      const addresses: LookupAddress[] = [
        { address: "93.184.216.34", family: 4 },
        { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
      ];
      const safeLookup = createSafeMcpLookup(async () => addresses);

      await expect(runLookup(safeLookup, "api.example.com")).resolves.toEqual(addresses);
    });
  });

  describe("safe fetch", () => {
    beforeEach(() => {
      undici.fetch.mockReset();
    });

    it("executes accepted public requests with the safe dispatcher", async () => {
      const response = new Response(null, { status: 204 });
      undici.fetch.mockResolvedValue(response);
      const safeFetch = createSafeMcpFetch();

      await expect(safeFetch("https://93.184.216.34/mcp")).resolves.toBe(response);
      expect(undici.fetch).toHaveBeenCalledOnce();
      expect(undici.fetch.mock.calls[0]?.[1]).toHaveProperty("dispatcher");
    });

    it("rejects a private request before invoking Undici", () => {
      const safeFetch = createSafeMcpFetch();

      expect(() => safeFetch("http://[fd12::1]/mcp")).toThrow("private IPv6 range not allowed");
      expect(undici.fetch).not.toHaveBeenCalled();
    });
  });
});

function runLookup(lookup: LookupFunction, hostname: string): Promise<LookupAddress[]> {
  return new Promise((resolve, reject) => {
    lookup(hostname, { all: true }, (error, addresses) => {
      if (error) {
        reject(error);
        return;
      }
      if (!Array.isArray(addresses)) {
        reject(new TypeError("Expected lookup to return all addresses."));
        return;
      }
      resolve(addresses);
    });
  });
}
