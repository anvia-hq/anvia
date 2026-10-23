import { execFileSync } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { findExecutable } from "../src/daemon/desktop/exec";
import { DesktopService } from "../src/daemon/desktop/service";
import { createDesktopTools, viewOf } from "../src/desktop-tools";
import { relayTicket, type SandboxDesktop } from "../src/remote/index";
import {
  type RemoteHarness,
  type RemoteHarnessOptions,
  createRemoteHarness,
  eventually,
  sandboxId,
} from "./support/remote-harness";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const required = ["Xvfb", "x11vnc", "xdotool", "xrandr", "import"];
const present = await Promise.all(
  [...required, "xev"].map((name) => findExecutable(name, process.env.PATH)),
);
const hasDesktop = process.platform !== "win32" && present.every((path) => path !== undefined);

const harnesses: RemoteHarness[] = [];
afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((harness) => harness.cleanup()));
});

let displayCounter = 0;
async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const { port } = server.address() as net.AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

/** A harness whose daemon has its own display and VNC port, so tests never share either. */
async function start(
  desktop: object = {},
  options: RemoteHarnessOptions = {},
): Promise<RemoteHarness & { desktop: SandboxDesktop }> {
  const created = await createRemoteHarness({
    ...options,
    daemon: {
      desktop: {
        display: `:${80 + (displayCounter += 1)}`,
        vncPort: await freePort(),
        restart: { initialDelayMs: 50, maxDelayMs: 200 },
        ...desktop,
      },
      ...options.daemon,
    },
  });
  harnesses.push(created);
  return Object.assign(created, { desktop: created.hub.desktop(sandboxId) });
}

/** Width and height from a PNG's header. */
function pngSize(png: Uint8Array) {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** A window that logs the input it receives, on the desktop's display. */
async function startXev(h: RemoteHarness & { desktop: SandboxDesktop }) {
  const status = await h.desktop.start();
  const process = await h.runtime.startProcess({
    command: "xev",
    args: ["-geometry", "400x300+100+100"],
    env: { DISPLAY: status.display },
  });
  const log = async () =>
    new TextDecoder().decode((await h.runtime.readProcessLogs({ processId: process.id })).stdout);
  // The window is mapped once xev reports its first event.
  await eventually(async () => (await log()).includes("MapNotify"), 10_000);
  await sleep(300);
  return { log };
}

describe.skipIf(!hasDesktop)("desktop", () => {
  it("starts on first use, not before", async () => {
    const h = await start();
    expect(await h.desktop.status()).toMatchObject({ state: "stopped", width: 1280, height: 800 });
    expect((await h.runtime.exec({ command: "pgrep", args: ["-x", "Xvfb"] })).status).toBe(
      "exited",
    );
    const before = await h.runtime.exec({ command: "pgrep", args: ["-x", "Xvfb"] });
    expect(before).toMatchObject({ exitCode: 1 });

    const status = await h.desktop.start();
    expect(status).toMatchObject({ state: "running", restarts: 0 });
    expect(await h.runtime.exec({ command: "pgrep", args: ["-x", "Xvfb"] })).toMatchObject({
      exitCode: 0,
    });
    expect(await h.runtime.exec({ command: "pgrep", args: ["-x", "x11vnc"] })).toMatchObject({
      exitCode: 0,
    });
  }, 30_000);

  it("starts when something asks for a screenshot, and shares one start between callers", async () => {
    const h = await start();
    const results = await Promise.all([h.desktop.screenshot(), h.desktop.screenshot()]);
    expect(results.map((shot) => pngSize(shot.png))).toEqual([
      { width: 1280, height: 800 },
      { width: 1280, height: 800 },
    ]);
    expect((await h.desktop.status()).state).toBe("running");
  }, 30_000);

  it("takes a screenshot of the expected size, optionally scaled", async () => {
    const h = await start({ resolution: { width: 1024, height: 768 } });
    const full = await h.desktop.screenshot();
    expect(pngSize(full.png)).toEqual({ width: 1024, height: 768 });
    expect(full).toMatchObject({
      width: 1024,
      height: 768,
      displayWidth: 1024,
      displayHeight: 768,
    });

    const half = await h.desktop.screenshot({ scale: 0.5 });
    expect(pngSize(half.png)).toEqual({ width: 512, height: 384 });
    expect(half).toMatchObject({ width: 512, height: 384, displayWidth: 1024, displayHeight: 768 });
  }, 30_000);

  it("delivers clicks, typing, keys, scrolling and drags to a window", async () => {
    const h = await start();
    const xev = await startXev(h);

    await h.desktop.act({ type: "click", x: 200, y: 200 });
    await eventually(async () => (await xev.log()).includes("ButtonPress"));
    expect(await h.desktop.cursorPosition()).toEqual({ x: 200, y: 200 });

    await h.desktop.act({ type: "type", text: "ab" });
    await eventually(async () => {
      const log = await xev.log();
      return log.includes("keysym 0x61, a") && log.includes("keysym 0x62, b");
    });

    await h.desktop.act({ type: "key", keys: "ctrl+a" });
    await eventually(async () => (await xev.log()).includes("keysym 0xffe3, Control_L"));

    await h.desktop.act({ type: "scroll", x: 220, y: 220, direction: "down", amount: 2 });
    await eventually(async () => (await xev.log()).includes("button 5"));

    await h.desktop.act({ type: "drag", fromX: 150, fromY: 150, toX: 300, toY: 250 });
    await eventually(async () => (await xev.log()).includes("MotionNotify"));

    await h.desktop.act({ type: "click", x: 210, y: 210, button: "right", count: 2 });
    await eventually(async () => ((await xev.log()).match(/button 3/g) ?? []).length >= 2);
  }, 60_000);

  it("rejects an input outside the display, or with half a point", async () => {
    const h = await start();
    await expect(h.desktop.act({ type: "mouse_move", x: 5_000, y: 10 })).rejects.toThrow(
      RangeError,
    );
    await expect(h.desktop.act({ type: "click", x: 10 })).rejects.toThrow(RangeError);
    await expect(h.desktop.act({ type: "key", keys: "ctrl+c; rm -rf /" })).rejects.toThrow();
  }, 30_000);

  it("resizes without restarting, and keeps windows open", async () => {
    const h = await start();
    const xev = await startXev(h);

    const resized = await h.desktop.resize(1024, 768);
    expect(resized).toMatchObject({ state: "running", width: 1024, height: 768, restarts: 0 });
    expect(pngSize((await h.desktop.screenshot()).png)).toEqual({ width: 1024, height: 768 });
    expect(await xev.log()).not.toContain("DestroyNotify");

    // Coordinates are checked against the new size.
    await expect(h.desktop.act({ type: "mouse_move", x: 1_200, y: 100 })).rejects.toThrow(
      RangeError,
    );
    // And a larger one than the display was started with is refused.
    await expect(h.desktop.resize(8_000, 8_000)).rejects.toThrow(RangeError);
    await h.desktop.resize(1920, 1080);
    expect(pngSize((await h.desktop.screenshot()).png)).toEqual({ width: 1920, height: 1080 });
  }, 60_000);

  describe("agent tools", () => {
    const callTool = (
      tools: ReturnType<typeof createDesktopTools>,
      name: string,
      args: unknown,
      context: object = {},
    ) => {
      const tool = tools.find((candidate) => candidate.name === name);
      if (tool === undefined) throw new Error(name);
      return Promise.resolve(tool.call(args as never, context));
    };

    it("click where the model pointed in a scaled screenshot, and respect the lock", async () => {
      // Big enough that the screenshot the model sees is scaled down.
      const h = await start({ resolution: { width: 2560, height: 1440 } });
      const tools = createDesktopTools({ sandbox: h.desktop });
      const view = viewOf(2560, 1440, { maxEdge: 1568, maxPixels: 1_150_000 });
      expect(view.scale).toBeLessThan(1);

      const shot = (await callTool(tools, "desktop_screenshot", {})) as {
        content: Array<{ type: string; text?: string; data?: { data: string } }>;
      };
      const meta = JSON.parse(shot.content[0]?.text ?? "{}") as { width: number; height: number };
      expect(meta).toEqual({ width: view.imageWidth, height: view.imageHeight });
      expect(pngSize(Buffer.from(shot.content[1]?.data?.data ?? "", "base64"))).toEqual(meta);

      // A window covering the display's centre, in display pixels.
      const status = await h.desktop.start();
      const xev = await h.runtime.startProcess({
        command: "xev",
        args: ["-geometry", "600x400+980+520"],
        env: { DISPLAY: status.display },
      });
      const log = async () =>
        new TextDecoder().decode((await h.runtime.readProcessLogs({ processId: xev.id })).stdout);
      await eventually(async () => (await log()).includes("MapNotify"), 10_000);
      await sleep(300);

      // The centre of the screenshot is the centre of the display, inside that window.
      await callTool(
        tools,
        "desktop_click",
        { coordinate: [view.imageWidth / 2, view.imageHeight / 2] },
        { operationId: "run/click-1" },
      );
      await eventually(async () => (await log()).includes("ButtonPress"));
      const clicked = /root:\((\d+),(\d+)\)/.exec(await log());
      expect(Math.abs(Number(clicked?.[1]) - 1280)).toBeLessThanOrEqual(2);
      expect(Math.abs(Number(clicked?.[2]) - 720)).toBeLessThanOrEqual(2);

      // The cursor comes back in the same screenshot space.
      expect(await callTool(tools, "desktop_cursor_position", {})).toEqual({
        coordinate: [Math.floor(view.imageWidth / 2), Math.floor(view.imageHeight / 2)],
      });

      // A point beyond the screenshot is refused before anything happens.
      await expect(
        callTool(tools, "desktop_click", { coordinate: [view.imageWidth, 0] }),
      ).rejects.toThrow(/outside the/);

      // While a person holds control the model's inputs fail with a typed, explanatory error.
      await h.desktop.takeover({ holder: "alice" });
      await expect(callTool(tools, "desktop_key", { text: "a" })).rejects.toMatchObject({
        code: "desktop_locked",
        message: expect.stringContaining("alice"),
      });
      await callTool(tools, "desktop_screenshot", {});
      await h.desktop.release({ holder: "alice" });
      await callTool(tools, "desktop_key", { text: "a" });
      await eventually(async () => (await log()).includes("keysym 0x61, a"));
    }, 60_000);
  });

  describe("control lock", () => {
    it("blocks the agent's inputs while a human holds control, and restores them on release", async () => {
      const h = await start();
      await h.desktop.takeover({ holder: "alice" });
      await expect(h.desktop.act({ type: "mouse_move", x: 10, y: 10 })).rejects.toMatchObject({
        code: "desktop_locked",
      });
      // Watching is never blocked.
      expect(pngSize((await h.desktop.screenshot()).png)).toEqual({ width: 1280, height: 800 });
      await h.desktop.cursorPosition();
      expect(await h.desktop.control()).toMatchObject({ held: true, holder: "alice" });

      await expect(h.desktop.takeover({ holder: "bob" })).rejects.toMatchObject({
        code: "desktop_locked",
      });
      await expect(h.desktop.release({ holder: "bob" })).rejects.toMatchObject({
        code: "desktop_locked",
      });

      await h.desktop.release({ holder: "alice" });
      await h.desktop.act({ type: "mouse_move", x: 10, y: 10 });
      expect(await h.desktop.cursorPosition()).toEqual({ x: 10, y: 10 });
    }, 30_000);

    it("lets an operator force control back", async () => {
      const h = await start();
      await h.desktop.takeover({ holder: "alice" });
      await expect(h.desktop.release({ holder: "bob" })).rejects.toMatchObject({
        code: "desktop_locked",
      });
      expect(await h.desktop.release({ holder: "bob", force: true })).toEqual({ held: false });
      await h.desktop.act({ type: "mouse_move", x: 3, y: 3 });
    }, 30_000);

    it("rejects an invalid input without starting the desktop", async () => {
      const h = await start();
      await expect(h.desktop.act({ type: "mouse_move", x: 9_000, y: 1 })).rejects.toThrow(
        RangeError,
      );
      expect((await h.desktop.status()).state).toBe("stopped");
    }, 30_000);

    it("gives control back when the lease runs out", async () => {
      const h = await start();
      await h.desktop.takeover({ holder: "alice", leaseMs: 400 });
      await expect(h.desktop.act({ type: "mouse_move", x: 1, y: 1 })).rejects.toMatchObject({
        code: "desktop_locked",
      });
      await sleep(600);
      await h.desktop.act({ type: "mouse_move", x: 1, y: 1 });
    }, 30_000);

    it("keeps the hold across a hub restart", async () => {
      const h = await start();
      await h.desktop.takeover({ holder: "alice" });
      await h.hub.close();
      await eventually(() => !h.daemon.connected);
      const { RemoteSandboxHub } = await import("../src/remote/index");
      const hub2 = new RemoteSandboxHub({
        authorize: () => ({ sandboxId }),
        connectTimeoutMs: 5_000,
      });
      await hub2.listen({ host: "127.0.0.1", port: h.port });
      try {
        await expect(
          hub2.desktop(sandboxId).act({ type: "mouse_move", x: 1, y: 1 }),
        ).rejects.toMatchObject({ code: "desktop_locked" });
      } finally {
        await hub2.close();
      }
    }, 30_000);

    it("can wait for a release instead of failing at once", async () => {
      const h = await start({ lock: { waitForReleaseMs: 3_000 } });
      await h.desktop.takeover({ holder: "alice" });
      const acting = h.desktop.act({ type: "mouse_move", x: 20, y: 20 });
      await sleep(300);
      await h.desktop.release({ holder: "alice" });
      await acting;
      expect(await h.desktop.cursorPosition()).toEqual({ x: 20, y: 20 });
    }, 30_000);
  });

  it("restarts a crashed display with its size and open to callers meanwhile", async () => {
    const h = await start();
    await h.desktop.resize(1024, 768);
    await h.runtime.exec({ command: "pkill", args: ["-9", "-x", "Xvfb"] });

    // A caller arriving mid-restart waits for it instead of failing.
    const shot = await h.desktop.screenshot();
    expect(pngSize(shot.png)).toEqual({ width: 1024, height: 768 });
    const status = await h.desktop.status();
    expect(status.restarts).toBeGreaterThanOrEqual(1);
    expect(status.state).toBe("running");
  }, 60_000);

  it("settles a caller waiting on a restart when the desktop is stopped", async () => {
    // Below the hub, which would retry the dropped call itself and hide whether the daemon
    // leaves it pending.
    const found = await DesktopService.detect(
      {
        display: `:${80 + (displayCounter += 1)}`,
        vncPort: await freePort(),
        restart: { initialDelayMs: 5_000, maxDelayMs: 5_000 },
      },
      { env: () => ({ ...process.env }) as Record<string, string>, log: () => undefined },
    );
    if (!("service" in found)) throw new Error(`missing ${found.missing.join(", ")}`);
    const { service } = found;
    await service.status(true);
    execFileSync("pkill", ["-9", "-x", "Xvfb"]);
    await eventually(async () => (await service.status()).state === "restarting", 10_000);

    // This caller is waiting for a restart that is five seconds away.
    const waiting = service.screenshot(undefined).then(
      () => "completed",
      () => "rejected",
    );
    await sleep(200);
    const stopped = Date.now();
    await service.stop();
    expect(await waiting).toBe("rejected");
    expect(Date.now() - stopped).toBeLessThan(3_000);
  }, 60_000);

  it("restarts the VNC server on its own, leaving the display alone", async () => {
    const h = await start();
    const status = await h.desktop.start();
    await h.runtime.exec({ command: "pkill", args: ["-9", "-x", "x11vnc"] });
    await eventually(async () => (await h.desktop.status()).restarts >= 1, 15_000);
    await eventually(async () => {
      const viewer = await h.desktop.openViewer();
      viewer.close();
      return true;
    }, 15_000);
    expect((await h.desktop.status()).vncPort).toBe(status.vncPort);
  }, 60_000);

  it("reaches VNC through a tunnel even when the daemon limits tunnel ports", async () => {
    const h = await start({}, { daemon: { tunnel: { allowedPorts: [1] } } });
    const viewer = await h.desktop.openViewer();
    const first = await viewer.output[Symbol.asyncIterator]().next();
    expect(new TextDecoder().decode(first.value).startsWith("RFB 003.")).toBe(true);
    viewer.close();
    // Other ports are still refused.
    await expect(h.hub.tunnel(sandboxId).open(2)).rejects.toMatchObject({ code: "port" });
  }, 30_000);

  it("listens for VNC on loopback only", async () => {
    const h = await start();
    const { vncPort } = await h.desktop.start();
    const listeners = execFileSync("sh", [
      "-c",
      `cat /proc/net/tcp /proc/net/tcp6 2>/dev/null || true`,
    ])
      .toString()
      .split("\n")
      .filter((line) => line.includes(`:${vncPort.toString(16).toUpperCase().padStart(4, "0")} `));
    const local = listeners.map((line) => line.trim().split(/\s+/)[1] ?? "");
    expect(local.length).toBeGreaterThan(0);
    for (const address of local) {
      // 0100007F is 127.0.0.1, and the IPv6 loopback is ...01000000 in /proc's byte order.
      expect(address).toMatch(/^(0100007F|00000000000000000000000001000000):/);
    }
  }, 30_000);
});

describe("desktop capability", () => {
  it("is not offered when the programs it needs are missing, and fails with a typed error", async () => {
    const h = await start({ binaries: { xvfb: "/nonexistent/Xvfb" } });
    await expect(h.desktop.start()).rejects.toMatchObject({ code: "unsupported" });
    await expect(h.desktop.screenshot()).rejects.toMatchObject({ code: "unsupported" });
    expect(h.logs.some((line) => line.includes("desktop unavailable"))).toBe(true);
  });

  describe("window manager default", () => {
    // Empty stand-ins for the programs the desktop needs, so nothing graphical runs.
    const detectWith = async (programs: string[], windowManager?: string | false) => {
      const dir = await mkdtemp(join(tmpdir(), "anvia-wm-"));
      try {
        for (const name of ["Xvfb", "x11vnc", "xdotool", "xrandr", "import", ...programs]) {
          await writeFile(join(dir, name), "#!/bin/sh\n");
          await chmod(join(dir, name), 0o755);
        }
        const logs: string[] = [];
        const found = await DesktopService.detect(
          windowManager === undefined ? {} : { windowManager },
          {
            env: () => ({ PATH: dir }),
            log: (line) => logs.push(line),
          },
        );
        expect("service" in found).toBe(true);
        return logs;
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    };

    it("prefers openbox-session, which runs the image's autostart file", async () => {
      // Had it fallen back to plain openbox, which is absent here, it would say so.
      expect(await detectWith(["openbox-session"])).toEqual([]);
    });

    it("falls back to openbox, and says when there is no window manager at all", async () => {
      expect(await detectWith(["openbox"])).toEqual([]);
      expect(await detectWith([])).toEqual([expect.stringContaining("openbox was not found")]);
    });

    it("uses the window manager it is told to", async () => {
      expect(await detectWith(["openbox-session"], "twm")).toEqual([
        expect.stringContaining("twm was not found"),
      ]);
    });
  });

  it("is not offered when switched off", async () => {
    const h = await createRemoteHarness({ daemon: { desktop: false } });
    harnesses.push(h);
    await expect(h.hub.desktop(sandboxId).control()).rejects.toMatchObject({
      code: "unsupported",
    });
    expect((await h.runtime.exec({ command: "true" })).status).toBe("exited");
  });
});

describe("browser desktop relay", () => {
  const origin = "https://app.example";

  async function relay(
    grant: { readOnly?: boolean; holder?: string } = {},
    daemon: RemoteHarnessOptions["daemon"] = {},
  ) {
    const display = `:${80 + (displayCounter += 1)}`;
    const vncPort = await freePort();
    const h = await createRemoteHarness({
      daemon: { desktop: { display, vncPort }, ...daemon },
      listen: { desktopPath: "/desktop" },
      hub: {
        allowedOrigins: [origin],
        authorizeDesktop: (request) => {
          const ticket = relayTicket(request);
          if (ticket === "rw") return { sandboxId, ...grant };
          if (ticket === "rw2") return { sandboxId, holder: "bob" };
          if (ticket === "ro") return { sandboxId, readOnly: true };
          return null;
        },
      },
    });
    harnesses.push(h);
    return { h, desktop: h.hub.desktop(sandboxId), url: `ws://127.0.0.1:${h.port}/desktop` };
  }

  function browser(url: string, options: { origin?: string | null; protocols?: string[] } = {}) {
    const clientOptions: WebSocket.ClientOptions = {};
    if (options.origin !== null) clientOptions.origin = options.origin ?? origin;
    const socket = new WebSocket(url, options.protocols ?? ["anvia.desktop.v1"], clientOptions);
    const state = {
      received: Buffer.alloc(0),
      text: [] as Array<Record<string, unknown>>,
      closed: undefined as { code: number; reason: string } | undefined,
    };
    socket.on("message", (data, isBinary) => {
      if (isBinary) state.received = Buffer.concat([state.received, data as Buffer]);
      else state.text.push(JSON.parse(data.toString()));
    });
    socket.on("close", (code, reason) => (state.closed = { code, reason: reason.toString() }));
    const refused = new Promise<number>((resolve) => {
      socket.once("unexpected-response", (_request, response) => resolve(response.statusCode ?? 0));
      socket.once("open", () => resolve(0));
      socket.once("error", () => undefined);
    });
    return { socket, state, refused };
  }

  it("refuses a missing or unknown ticket with 401, and a foreign Origin with 403", async () => {
    const { url } = await relay();
    expect(await browser(url).refused).toBe(401);
    expect(await browser(`${url}?ticket=nope`).refused).toBe(401);
    expect(
      await browser(url, { protocols: ["anvia.desktop.v1", "anvia.ticket.nope"] }).refused,
    ).toBe(401);
    expect(await browser(`${url}?ticket=rw`, { origin: "https://evil.example" }).refused).toBe(403);
  });

  it("answers 404 when the hub has no desktop authorizer", async () => {
    const h = await createRemoteHarness({ listen: { desktopPath: "/desktop" } });
    harnesses.push(h);
    expect(await browser(`ws://127.0.0.1:${h.port}/desktop?ticket=rw`).refused).toBe(404);
  });

  it("reports a daemon without a desktop as a typed close reason", async () => {
    const { url } = await relay({}, { desktop: false });
    const viewer = browser(`${url}?ticket=rw`);
    await viewer.refused;
    await eventually(() => viewer.state.closed !== undefined);
    expect(viewer.state.closed?.code).toBe(1011);
    expect(viewer.state.closed?.reason).toMatch(/^unsupported:/);
  });

  describe.skipIf(!hasDesktop)("with a running desktop", () => {
    /** Just enough of an RFB client to connect and send a pointer click. */
    async function rfb(viewer: ReturnType<typeof browser>) {
      let consumed = 0;
      const read = async (length: number) => {
        await eventually(() => viewer.state.received.length - consumed >= length, 10_000);
        const bytes = viewer.state.received.subarray(consumed, consumed + length);
        consumed += length;
        return bytes;
      };
      expect((await read(12)).toString()).toMatch(/^RFB 003\.\d{3}\n$/);
      viewer.socket.send(Buffer.from("RFB 003.008\n"));
      const count = (await read(1))[0] ?? 0;
      await read(count); // Security types.
      viewer.socket.send(Buffer.from([1])); // None.
      await read(4); // SecurityResult.
      viewer.socket.send(Buffer.from([1])); // ClientInit: shared.
      const init = await read(24);
      await read(init.readUInt32BE(20)); // Desktop name.
      return {
        click(x: number, y: number) {
          const event = (mask: number) => {
            const out = Buffer.alloc(6);
            out[0] = 5;
            out[1] = mask;
            out.writeUInt16BE(x, 2);
            out.writeUInt16BE(y, 4);
            return out;
          };
          viewer.socket.send(Buffer.concat([event(0), event(1), event(0)]));
        },
      };
    }

    it("lets a writable viewer click, and drops a read-only viewer's input", async () => {
      const { h, desktop, url } = await relay();
      const xev = await startXev(Object.assign(h, { desktop }));

      const readOnly = browser(`${url}?ticket=ro`);
      await readOnly.refused;
      (await rfb(readOnly)).click(200, 200);
      await sleep(800);
      expect(await xev.log()).not.toContain("ButtonPress");

      const writable = browser(`${url}?ticket=rw`);
      await writable.refused;
      (await rfb(writable)).click(200, 200);
      await eventually(async () => (await xev.log()).includes("ButtonPress"));
      readOnly.socket.close();
      writable.socket.close();
    }, 60_000);

    it("lets a viewer take control, which pauses the agent and mutes other viewers", async () => {
      const { h, desktop, url } = await relay({ holder: "alice" });
      const xev = await startXev(Object.assign(h, { desktop }));

      const alice = browser(`${url}?ticket=rw`);
      await alice.refused;
      const aliceRfb = await rfb(alice);
      await eventually(() => alice.state.text.some((message) => message.type === "control"));

      alice.socket.send(JSON.stringify({ type: "takeover" }));
      await eventually(async () => (await desktop.control()).holder === "alice");
      await expect(desktop.act({ type: "mouse_move", x: 5, y: 5 })).rejects.toMatchObject({
        code: "desktop_locked",
      });
      await eventually(() =>
        alice.state.text.some((message) => message.type === "control" && message.you === true),
      );

      // Bob may type in general, but not while alice holds control...
      const bob = browser(`${url}?ticket=rw2`);
      await bob.refused;
      const bobRfb = await rfb(bob);
      bobRfb.click(200, 200);
      await sleep(800);
      expect(await xev.log()).not.toContain("ButtonPress");

      // ...and alice, who holds it, still can.
      aliceRfb.click(200, 200);
      await eventually(async () => (await xev.log()).includes("ButtonPress"));

      // Closing the tab hands control back to the agent.
      alice.socket.close();
      await eventually(async () => !(await desktop.control()).held, 10_000);
      await desktop.act({ type: "mouse_move", x: 5, y: 5 });

      // Each relay learns that control is free from its next poll, and tells its viewer. Input in
      // between is dropped rather than risk letting it through, so wait for that, as a user would.
      await eventually(() => {
        const controls = bob.state.text.filter((message) => message.type === "control");
        return controls.at(-1)?.held === false;
      });
      const before = ((await xev.log()).match(/ButtonPress/g) ?? []).length;
      bobRfb.click(210, 210);
      await eventually(async () => ((await xev.log()).match(/ButtonPress/g) ?? []).length > before);
      bob.socket.close();
    }, 60_000);

    it("rejects takeover from a read-only viewer", async () => {
      const { url, desktop } = await relay();
      const viewer = browser(`${url}?ticket=ro`);
      await viewer.refused;
      await eventually(() => viewer.state.text.some((message) => message.type === "control"));
      viewer.socket.send(JSON.stringify({ type: "takeover" }));
      await eventually(() => viewer.state.text.some((message) => message.type === "error"));
      expect(viewer.state.text.find((message) => message.type === "error")).toMatchObject({
        code: "tool_policy",
      });
      expect((await desktop.control()).held).toBe(false);
      viewer.socket.close();
    }, 30_000);
  });
});
