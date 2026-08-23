import { DockerSandboxClient } from "@anvia/sandbox";
import { describe, expect, it } from "vitest";
import { DockerBrowserClient } from "../src/docker-browser";
import { createBrowserTools } from "../src/tools";

const enabled = process.env.ANVIA_BROWSER_DOCKER_TESTS === "1";
const image = process.env.ANVIA_BROWSER_TEST_IMAGE ?? "anvia-browser:test";

describe.skipIf(!enabled)("Docker browser integration", () => {
  it("runs sandboxed visible Chromium, CDP, noVNC, and semantic tools", async () => {
    const browserClient = new DockerBrowserClient({
      sandboxClient: new DockerSandboxClient(),
      image,
    });
    const browser = await browserClient.createBrowser({
      workspace: { type: "ephemeral" },
      network: { mode: "bridge" },
      desktop: {
        protocol: "novnc",
        password: "passw0rd",
        viewport: { width: 1024, height: 768 },
      },
      resources: { memoryMb: 2048, cpus: 2, pidsLimit: 512, sharedMemoryMb: 1024 },
      runtime: { maxProcesses: 4, commandTimeoutMs: 30_000 },
    });

    try {
      try {
        await browser.waitUntilReady({ timeoutMs: 15_000 });
      } catch (error) {
        const processes = await browser.sandbox.runtime.listProcesses();
        for (const process of processes) {
          const logs = await browser.sandbox.runtime.readProcessLogs({ processId: process.id });
          console.error({
            process,
            stdout: new TextDecoder().decode(logs.stdout).slice(-6_000),
            stderr: new TextDecoder().decode(logs.stderr).slice(-6_000),
          });
        }
        throw error;
      }
      expect(
        browser.sandbox.runtime.publishedPorts.map((port) => port.containerPort).sort(),
      ).toEqual([6080, 9222]);

      const identity = await browser.sandbox.runtime.exec({ command: "id", args: ["-u"] });
      expect(identity.status).toBe("exited");
      expect(new TextDecoder().decode(identity.stdout).trim()).not.toBe("0");
      const processes = await browser.sandbox.runtime.exec({
        command: "sh",
        args: ["-c", "tr '\\0' ' ' </proc/$(pgrep -o chrome)/cmdline"],
      });
      expect(new TextDecoder().decode(processes.stdout)).not.toContain("--no-sandbox");

      await browser.sandbox.runtime.startProcess({
        command: "node",
        args: [
          "-e",
          [
            'const { createServer } = require("node:http");',
            'createServer((_req, res) => res.end("<button>Continue</button><main>Browser ready</main>"))',
            '.listen(8080, "127.0.0.1");',
          ].join(""),
        ],
      });
      await using connection = await browser.connect();
      const tools = createBrowserTools({
        connection,
        tools: ["browser_navigate", "browser_snapshot", "browser_screenshot"],
        navigation: { mode: "origins", origins: ["http://127.0.0.1:8080"] },
      });
      const navigate = tools.find((tool) => tool.name === "browser_navigate");
      const snapshot = tools.find((tool) => tool.name === "browser_snapshot");
      const screenshot = tools.find((tool) => tool.name === "browser_screenshot");
      await navigate?.call({ url: "http://127.0.0.1:8080" });
      await expect(snapshot?.call({})).resolves.toMatchObject({ truncated: false });
      await expect(screenshot?.call({})).resolves.toMatchObject({
        content: [expect.any(Object), { type: "file", mediaType: "image/png" }],
      });
      await connection.disconnect();
      await browser.waitUntilReady({ timeoutMs: 5_000 });
      await using resumedConnection = await browser.connect();
      await expect(resumedConnection.listTabs()).resolves.not.toHaveLength(0);
    } finally {
      await browser.destroy();
    }
  }, 120_000);
});
