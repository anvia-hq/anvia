import { describe, expect, it } from "vitest";
import { Studio } from "../src/index";

describe("Studio Host and Origin validation", () => {
  it("rejects a non-localhost Host header with 403", async () => {
    const studio = new Studio([], { ui: false });
    try {
      const response = await studio.fetch(
        new Request("http://localhost:4021/sessions", {
          method: "POST",
          headers: { host: "attacker.test:4021", "content-type": "application/json" },
          body: "{}",
        }),
      );
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: { code: "forbidden" } });
    } finally {
      studio.close();
    }
  });

  it("rejects a foreign Origin header with 403", async () => {
    const studio = new Studio([], { ui: false });
    try {
      const response = await studio.fetch(
        new Request("http://localhost:4021/health", {
          headers: { origin: "https://attacker.test" },
        }),
      );
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: { code: "forbidden" } });
    } finally {
      studio.close();
    }
  });

  it("allows a localhost Host with no Origin", async () => {
    const studio = new Studio([], { ui: false });
    try {
      const response = await studio.fetch(
        new Request("http://localhost:4021/health", {
          headers: { host: "localhost:4021" },
        }),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ status: "ok" });
    } finally {
      studio.close();
    }
  });
});
