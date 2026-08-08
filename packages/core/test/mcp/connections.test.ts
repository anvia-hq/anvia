import { describe, expect, test } from "vitest";
import { mcp } from "../../src/mcp/connections.js";

describe("MCP Connection SSRF Protection", () => {
  describe("http() URL validation", () => {
    test("allows valid public HTTPS URLs", () => {
      expect(() => {
        mcp.http({ name: "test", url: "https://api.example.com/mcp" });
      }).not.toThrow();
    });

    test("allows valid public HTTP URLs", () => {
      expect(() => {
        mcp.http({ name: "test", url: "http://api.example.com/mcp" });
      }).not.toThrow();
    });

    test("blocks localhost by name", async () => {
      const connection = mcp.http({ name: "test", url: "http://localhost:3000/mcp" });
      await expect(connection.connect()).rejects.toThrow("MCP URL blocked: localhost not allowed");
    });

    test("blocks 127.0.0.1", async () => {
      const connection = mcp.http({ name: "test", url: "http://127.0.0.1:3000/mcp" });
      await expect(connection.connect()).rejects.toThrow("MCP URL blocked: localhost not allowed");
    });

    test("blocks 127.x.x.x range", async () => {
      const connection = mcp.http({ name: "test", url: "http://127.1.2.3:3000/mcp" });
      await expect(connection.connect()).rejects.toThrow("MCP URL blocked: localhost not allowed");
    });

    test("blocks IPv6 localhost ::1", async () => {
      const connection = mcp.http({ name: "test", url: "http://[::1]:3000/mcp" });
      await expect(connection.connect()).rejects.toThrow("MCP URL blocked: localhost not allowed");
    });

    test("blocks private IPv4 10.x.x.x", async () => {
      const connection = mcp.http({ name: "test", url: "http://10.0.0.1/mcp" });
      await expect(connection.connect()).rejects.toThrow(
        "MCP URL blocked: private IP range not allowed",
      );
    });

    test("blocks private IPv4 172.16.x.x to 172.31.x.x", async () => {
      const connection = mcp.http({ name: "test", url: "http://172.16.0.1/mcp" });
      await expect(connection.connect()).rejects.toThrow(
        "MCP URL blocked: private IP range not allowed",
      );
    });

    test("blocks private IPv4 192.168.x.x", async () => {
      const connection = mcp.http({ name: "test", url: "http://192.168.1.1/mcp" });
      await expect(connection.connect()).rejects.toThrow(
        "MCP URL blocked: private IP range not allowed",
      );
    });

    test("blocks link-local IPv4 169.254.x.x", async () => {
      const connection = mcp.http({ name: "test", url: "http://169.254.1.1/mcp" });
      await expect(connection.connect()).rejects.toThrow(
        "MCP URL blocked: private IP range not allowed",
      );
    });

    test("blocks AWS metadata endpoint 169.254.169.254", async () => {
      const connection = mcp.http({
        name: "test",
        url: "http://169.254.169.254/latest/meta-data/",
      });
      await expect(connection.connect()).rejects.toThrow(
        "MCP URL blocked: cloud metadata endpoint not allowed",
      );
    });

    test("blocks IPv6 link-local fe80::", async () => {
      const connection = mcp.http({ name: "test", url: "http://[fe80::1]/mcp" });
      await expect(connection.connect()).rejects.toThrow(
        "MCP URL blocked: private IPv6 range not allowed",
      );
    });

    test("blocks IPv6 unique local fc00::", async () => {
      const connection = mcp.http({ name: "test", url: "http://[fc00::1]/mcp" });
      await expect(connection.connect()).rejects.toThrow(
        "MCP URL blocked: private IPv6 range not allowed",
      );
    });

    test("blocks IPv6 unique local fd00::", async () => {
      const connection = mcp.http({ name: "test", url: "http://[fd00::1]/mcp" });
      await expect(connection.connect()).rejects.toThrow(
        "MCP URL blocked: private IPv6 range not allowed",
      );
    });

    test("blocks invalid URL format", async () => {
      const connection = mcp.http({ name: "test", url: "not-a-valid-url" });
      await expect(connection.connect()).rejects.toThrow("Invalid MCP URL");
    });
  });

  describe("sse() URL validation", () => {
    test("allows valid public HTTPS URLs", () => {
      expect(() => {
        mcp.sse({ name: "test", url: "https://api.example.com/mcp" });
      }).not.toThrow();
    });

    test("blocks localhost", async () => {
      const connection = mcp.sse({ name: "test", url: "http://localhost:3000/mcp" });
      await expect(connection.connect()).rejects.toThrow("MCP URL blocked: localhost not allowed");
    });

    test("blocks private IP 10.0.0.1", async () => {
      const connection = mcp.sse({ name: "test", url: "http://10.0.0.1/mcp" });
      await expect(connection.connect()).rejects.toThrow(
        "MCP URL blocked: private IP range not allowed",
      );
    });

    test("blocks AWS metadata endpoint", async () => {
      const connection = mcp.sse({ name: "test", url: "http://169.254.169.254/latest/meta-data/" });
      await expect(connection.connect()).rejects.toThrow(
        "MCP URL blocked: cloud metadata endpoint not allowed",
      );
    });
  });

  describe("stdio() does not validate URLs", () => {
    test("allows stdio connections without URL validation", () => {
      expect(() => {
        mcp.stdio({ name: "test", command: "node", args: ["server.js"] });
      }).not.toThrow();
    });
  });
});
