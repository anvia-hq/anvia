import { request as requestNode } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { Studio } from "../src/index";

const studios: Studio[] = [];

afterEach(() => {
  while (studios.length > 0) {
    studios.pop()?.close();
  }
});

function track(studio: Studio): Studio {
  studios.push(studio);
  return studio;
}

describe("Studio Host and Origin validation", () => {
  it("rejects a non-localhost Host header with 403", async () => {
    const studio = track(new Studio([], { ui: false }));
    const response = await studio.fetch(
      new Request("http://localhost:4021/sessions", {
        method: "POST",
        headers: { host: "attacker.test:4021", "content-type": "application/json" },
        body: "{}",
      }),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "forbidden" } });
  });

  it("rejects a foreign Origin header with 403", async () => {
    const studio = track(new Studio([], { ui: false }));
    const response = await studio.fetch(
      new Request("http://localhost:4021/health", {
        headers: { origin: "https://attacker.test" },
      }),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "forbidden" } });
  });

  it("allows a localhost Host with no Origin", async () => {
    const studio = track(new Studio([], { ui: false }));
    const response = await studio.fetch(
      new Request("http://localhost:4021/health", {
        headers: { host: "localhost:4021" },
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "ok" });
  });

  it("accepts a custom allowed Host when the server allows it", async () => {
    const { studio, port } = await startStudio({ allowedHosts: ["studio.lan"] });
    try {
      const raw = await fetchRaw(`http://127.0.0.1:${port}/health`, "studio.lan:4021");
      expect(raw.status).toBe(200);
    } finally {
      studio.close();
    }
  });

  it("still rejects foreign Hosts when custom hosts are allowed", async () => {
    const { studio, port } = await startStudio({ allowedHosts: ["studio.lan"] });
    try {
      const raw = await fetchRaw(`http://127.0.0.1:${port}/health`, "attacker.test");
      expect(raw.status).toBe(403);
    } finally {
      studio.close();
    }
  });

  it("accepts the bind Host without extra config when bound to a non-loopback address", async () => {
    const lanAddress = await lanIpv4Address();
    const { studio, port } = await startStudio({ hostname: lanAddress });
    try {
      const response = await fetch(`http://${lanAddress}:${port}/health`);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ status: "ok" });

      const raw = await fetchRaw(`http://${lanAddress}:${port}/health`, "attacker.test");
      expect(raw.status).toBe(403);
    } finally {
      studio.close();
    }
  });

  it("accepts an allowlisted non-loopback Origin while rejecting others", async () => {
    const { studio, port } = await startStudio({ allowedHosts: ["studio.lan"] });
    try {
      const allowed = await fetch(`http://127.0.0.1:${port}/health`, {
        headers: { host: "studio.lan", origin: "http://studio.lan:4021" },
      });
      expect(allowed.status).toBe(200);

      const rejected = await fetch(`http://127.0.0.1:${port}/health`, {
        headers: { host: "studio.lan", origin: "https://attacker.test" },
      });
      expect(rejected.status).toBe(403);
    } finally {
      studio.close();
    }
  });
});

async function startStudio(options: { allowedHosts?: string[]; hostname?: string }): Promise<{
  studio: Studio;
  port: number;
}> {
  const studio = track(new Studio([], { ui: false }));
  const serveOptions: { port: number; hostname: string; allowedHosts?: string[] } = {
    port: 0,
    hostname: options.hostname ?? "127.0.0.1",
  };
  if (options.allowedHosts !== undefined) serveOptions.allowedHosts = options.allowedHosts;
  studio.start({ ...serveOptions, log: false, handleSignals: false });
  const port = await studioPort(studio);
  return { studio, port };
}

async function fetchRaw(url: string, host: string): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const request = requestNode(
      {
        hostname: target.hostname,
        port: Number(target.port),
        path: `${target.pathname}${target.search}`,
        method: "GET",
        headers: { host, connection: "close" },
      },
      (response) => {
        response.resume();
        resolve({ status: response.statusCode ?? 0 });
      },
    );
    request.on("error", reject);
    request.end();
  });
}

async function studioPort(studio: Studio): Promise<number> {
  const handle = (studio as unknown as { server?: { address(): unknown } }).server;
  const startedAt = Date.now();
  while (Date.now() - startedAt < 5_000) {
    const address = handle?.address();
    if (typeof address === "object" && address !== null && "port" in address) {
      return (address as { port: number }).port;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Expected Studio to listen on a TCP port");
}

async function lanIpv4Address(): Promise<string> {
  const lan = await findLanIpv4();
  if (lan === undefined) throw new Error("No non-loopback IPv4 address available");
  return lan;
}

async function findLanIpv4(): Promise<string | undefined> {
  const { networkInterfaces } = await import("node:os");
  for (const interfaces of Object.values(networkInterfaces())) {
    for (const entry of interfaces ?? []) {
      if (entry.family === "IPv4" && !entry.internal) return entry.address;
    }
  }
  return undefined;
}
