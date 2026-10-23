import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import net from "node:net";
import WebSocket from "ws";
import { RemoteSandboxHub, relayTicket } from "../src/remote/index";

// Measures how smooth the reference desktop is, on three paths to the same VNC server:
//
//   direct   an RFB client inside the container, on the VNC port (no daemon, hub or relay)
//   relay    an RFB client on a browser-style WebSocket to the hub's desktop relay, which reaches
//            the VNC server through daemon -> hub -> relay (what a real viewer gets)
//
// The relay path runs at each simulated round-trip time. The delay is a TCP proxy between the
// daemon and the hub (so it works on Docker Desktop, where tc netem does not reach the right
// network), splitting the RTT across both directions. It does not delay the hub's own hop to the
// viewer, which is local here.
//
//   pnpm cookbook:remote-sandbox:image      # build the reference image first
//   pnpm --filter @anvia/sandbox bench:desktop -- --label baseline
//
// Options: --image <name> (default anvia-desktop), --rtt <ms,ms,...> (default 0,100),
// --label <text> (names the run in the output), --seconds <n> (throughput run, default 8),
// --moves <n> (latency samples, default 30).

const args = process.argv.slice(2);
const option = (name: string, fallback: string) => {
  const at = args.indexOf(name);
  return at === -1 ? fallback : (args[at + 1] ?? fallback);
};
const image = option("--image", "anvia-desktop");
const skipDirect = args.includes("--no-direct");
const rtts = option("--rtt", "0,100")
  .split(",")
  .map((value) => Number(value));
const label = option("--label", "run");
const throughputSeconds = Number(option("--seconds", "8"));
const moves = Number(option("--moves", "30"));
const sandboxId = "bench";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const now = () => performance.now();

// ---- a link with a delay you can change ---------------------------------------------------------
class DelayProxy {
  /** One-way delay in ms, read for every chunk, so it can change under open connections. */
  oneWayMs = 0;
  private readonly server = net.createServer((client) => {
    const upstream = net.connect({ host: "127.0.0.1", port: this.target });
    const forward = (from: net.Socket, to: net.Socket) => {
      from.on("data", (chunk) => {
        // Equal delays keep timers in order, so bytes stay in order.
        if (this.oneWayMs === 0) to.write(chunk);
        else setTimeout(() => to.writable && to.write(chunk), this.oneWayMs);
      });
      from.on("close", () => setTimeout(() => to.destroy(), this.oneWayMs));
      from.on("error", () => to.destroy());
    };
    forward(client, upstream);
    forward(upstream, client);
  });

  constructor(private readonly target: number) {}

  listen(): Promise<number> {
    return new Promise((resolve) => {
      this.server.listen(0, "0.0.0.0", () =>
        resolve((this.server.address() as net.AddressInfo).port),
      );
    });
  }

  close() {
    this.server.close();
  }
}

// ---- a minimal RFB client: just enough to know where each update ends ---------------------------
interface Transport {
  write(data: Buffer): void;
  onData(handler: (data: Buffer) => void): void;
  close(): void;
}

interface UpdateStats {
  at: number;
  bytes: number;
  rects: number;
}

const encodingRaw = 0;
const encodingCopyRect = 1;
const encodingZrle = 16;

/**
 * Speaks RFB 3.8 with no security, asks for ZRLE, CopyRect and Raw, and keeps requesting incremental
 * updates the way a viewer does. It never decodes pixels: ZRLE is length-prefixed, so it can frame
 * every update without doing so.
 */
class RfbClient {
  width = 0;
  height = 0;
  private bytesPerPixel = 4;
  private buffer: Buffer = Buffer.alloc(0);
  private stage: "version" | "security" | "result" | "init" | "messages" = "version";
  private ready: (() => void) | undefined;
  private failure: ((error: Error) => void) | undefined;
  private listeners = new Set<(update: UpdateStats) => void>();
  private requesting = false;

  constructor(
    private readonly transport: Transport,
    private readonly encodings: number[] = [encodingZrle, encodingCopyRect, encodingRaw],
  ) {
    transport.onData((data) => {
      this.buffer = this.buffer.length === 0 ? data : Buffer.concat([this.buffer, data]);
      try {
        while (this.step()) {
          // Keep parsing while a whole message is buffered.
        }
      } catch (error) {
        this.failure?.(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  connect(timeoutMs = 20_000): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("RFB handshake timed out")), timeoutMs);
      this.ready = () => {
        clearTimeout(timer);
        resolve();
      };
      this.failure = reject;
    });
  }

  onUpdate(listener: (update: UpdateStats) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Ask for changes, and keep asking each time an update lands. */
  startRequesting(): void {
    if (this.requesting) return;
    this.requesting = true;
    this.request(false);
    this.onUpdate(() => this.request(true));
  }

  close() {
    this.transport.close();
  }

  private request(incremental: boolean) {
    const message = Buffer.alloc(10);
    message[0] = 3;
    message[1] = incremental ? 1 : 0;
    message.writeUInt16BE(0, 2);
    message.writeUInt16BE(0, 4);
    message.writeUInt16BE(this.width, 6);
    message.writeUInt16BE(this.height, 8);
    this.transport.write(message);
  }

  private take(length: number): Buffer | undefined {
    if (this.buffer.length < length) return undefined;
    const taken = this.buffer.subarray(0, length);
    this.buffer = this.buffer.subarray(length);
    return taken;
  }

  /** Consume one thing from the stream. False when more bytes are needed. */
  private step(): boolean {
    switch (this.stage) {
      case "version": {
        if (this.take(12) === undefined) return false;
        this.transport.write(Buffer.from("RFB 003.008\n"));
        this.stage = "security";
        return true;
      }
      case "security": {
        const count = this.buffer[0];
        if (count === undefined || this.buffer.length < 1 + count) return false;
        const types = [...this.buffer.subarray(1, 1 + count)];
        this.buffer = this.buffer.subarray(1 + count);
        if (!types.includes(1)) throw new Error(`No "none" security type (got ${types.join()})`);
        this.transport.write(Buffer.from([1]));
        this.stage = "result";
        return true;
      }
      case "result": {
        const result = this.take(4);
        if (result === undefined) return false;
        if (result.readUInt32BE(0) !== 0) throw new Error("RFB security failed");
        this.transport.write(Buffer.from([1])); // Shared.
        this.stage = "init";
        return true;
      }
      case "init": {
        if (this.buffer.length < 24) return false;
        const nameLength = this.buffer.readUInt32BE(20);
        const init = this.take(24 + nameLength);
        if (init === undefined) return false;
        this.width = init.readUInt16BE(0);
        this.height = init.readUInt16BE(2);
        this.bytesPerPixel = (init[4] ?? 32) / 8;
        const { encodings } = this;
        const message = Buffer.alloc(4 + encodings.length * 4);
        message[0] = 2;
        message.writeUInt16BE(encodings.length, 2);
        encodings.forEach((encoding, index) => message.writeInt32BE(encoding, 4 + index * 4));
        this.transport.write(message);
        this.stage = "messages";
        this.ready?.();
        return true;
      }
      case "messages":
        return this.message();
    }
  }

  private message(): boolean {
    const type = this.buffer[0];
    if (type === undefined) return false;
    if (type === 2) {
      this.take(1); // Bell.
      return true;
    }
    if (type === 3) {
      if (this.buffer.length < 8) return false;
      return this.take(8 + this.buffer.readUInt32BE(4)) !== undefined;
    }
    if (type !== 0) throw new Error(`Unexpected server message ${type}`);

    // FramebufferUpdate: parse the whole thing before consuming any of it.
    if (this.buffer.length < 4) return false;
    const rects = this.buffer.readUInt16BE(2);
    let offset = 4;
    for (let index = 0; index < rects; index += 1) {
      if (this.buffer.length < offset + 12) return false;
      const width = this.buffer.readUInt16BE(offset + 4);
      const height = this.buffer.readUInt16BE(offset + 6);
      const encoding = this.buffer.readInt32BE(offset + 8);
      offset += 12;
      if (encoding === encodingRaw) {
        offset += width * height * this.bytesPerPixel;
      } else if (encoding === encodingCopyRect) {
        offset += 4;
      } else if (encoding === encodingZrle) {
        if (this.buffer.length < offset + 4) return false;
        offset += 4 + this.buffer.readUInt32BE(offset);
      } else {
        throw new Error(`Unexpected encoding ${encoding}`);
      }
      if (this.buffer.length < offset) return false;
    }
    this.take(offset);
    const update = { at: now(), bytes: offset, rects };
    for (const listener of this.listeners) listener(update);
    return true;
  }
}

// ---- the two paths to the VNC server ------------------------------------------------------------
function dockerExec(container: string, argv: string[]): ChildProcess {
  return spawn("docker", ["exec", "-i", container, ...argv], { stdio: ["pipe", "pipe", "ignore"] });
}

/** An RFB client inside the container: the VNC port, with nothing of Anvia's in the way. */
function directTransport(container: string, port: number): Transport {
  const bridge = `const s=require("net").connect(${port},"127.0.0.1");process.stdin.pipe(s);s.pipe(process.stdout);s.on("close",()=>process.exit())`;
  const child = dockerExec(container, ["node", "-e", bridge]);
  return {
    write: (data) => void child.stdin?.write(data),
    onData: (handler) => void child.stdout?.on("data", handler),
    close: () => void child.kill(),
  };
}

/** A browser-style viewer on the hub's desktop relay. */
function relayTransport(url: string, ticket: string): Transport {
  const socket = new WebSocket(url, [`anvia.ticket.${ticket}`, "anvia.desktop.v1"]);
  const opened = new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
  return {
    write: (data) => void opened.then(() => socket.send(data)),
    onData: (handler) =>
      socket.on("message", (data, isBinary) => {
        if (isBinary) handler(Buffer.isBuffer(data) ? data : Buffer.concat(data as Buffer[]));
      }),
    close: () => socket.close(),
  };
}

// ---- a shell inside the container to act and to read CPU ----------------------------------------
class Shell {
  private readonly child: ChildProcess;
  private output = "";
  private waiting: { marker: string; resolve: (text: string) => void } | undefined;

  constructor(container: string) {
    this.child = dockerExec(container, ["sh"]);
    this.child.stdout?.on("data", (chunk: Buffer) => {
      this.output += chunk.toString("utf8");
      const waiting = this.waiting;
      const at = waiting === undefined ? -1 : this.output.indexOf(waiting.marker);
      if (waiting !== undefined && at !== -1) {
        this.waiting = undefined;
        const text = this.output.slice(0, at);
        this.output = "";
        waiting.resolve(text);
      }
    });
    this.child.stdin?.write("export DISPLAY=:99 HOME=/home/node\n");
  }

  /** Send a command and don't wait for it. */
  fire(command: string) {
    this.child.stdin?.write(`${command}\n`);
  }

  /** Run a command and return what it printed. */
  run(command: string): Promise<string> {
    const marker = `__done_${randomBytes(4).toString("hex")}__`;
    return new Promise((resolve) => {
      this.waiting = { marker, resolve };
      this.child.stdin?.write(`${command}\necho ${marker}\n`);
    });
  }

  close() {
    this.child.kill();
  }
}

const cpuProgram = ["node", "x11vnc", "Xvfb", "Xvnc", "picom", "plank"];
const cpuCommand = `for n in ${cpuProgram.join(" ")}; do ids=$(pgrep -x $n); if [ -z "$ids" ]; then echo "$n -"; continue; fi; t=0; for p in $ids; do t=$((t + $(awk '{print $14+$15}' /proc/$p/stat))); done; echo "$n $t"; done`;

async function cpuTicks(shell: Shell): Promise<Map<string, number>> {
  const text = await shell.run(cpuCommand);
  return new Map(
    text
      .trim()
      .split("\n")
      .map((line) => line.split(" ") as [string, string])
      .filter(([, ticks]) => ticks !== "-")
      .map(([name, ticks]) => [name, Number(ticks)]),
  );
}

// ---- measurements -------------------------------------------------------------------------------
const percentile = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? Number.NaN;

/** Wait until no update has arrived for `quietMs`. */
async function settle(client: RfbClient, quietMs = 400): Promise<void> {
  let last = now();
  const stop = client.onUpdate(() => {
    last = now();
  });
  while (now() - last < quietMs) await sleep(50);
  stop();
}

/** Move a window, and time how long until the viewer has an update. */
async function measureLatency(
  client: RfbClient,
  shell: Shell,
  windowId: string,
): Promise<number[]> {
  const samples: number[] = [];
  const spots = [
    [100, 100],
    [700, 400],
  ] as const;
  for (let index = 0; index < moves + 3; index += 1) {
    await settle(client);
    const [x, y] = spots[index % 2] ?? spots[0];
    const arrived = new Promise<number>((resolve) => {
      const stop = client.onUpdate((update) => {
        stop();
        resolve(update.at);
      });
    });
    const start = now();
    shell.fire(`xdotool windowmove ${windowId} ${x} ${y}`);
    const at = await Promise.race([arrived, sleep(5_000).then(() => Number.NaN)]);
    if (index >= 3 && !Number.isNaN(at)) samples.push(at - start); // The first few warm things up.
  }
  return samples.sort((a, b) => a - b);
}

interface Throughput {
  mbPerSecond: number;
  updatesPerSecond: number;
  cpu: Map<string, number>;
}

async function measureThroughput(client: RfbClient, shell: Shell): Promise<Throughput> {
  let bytes = 0;
  let updates = 0;
  const stop = client.onUpdate((update) => {
    bytes += update.bytes;
    updates += 1;
  });
  const before = await cpuTicks(shell);
  const start = now();
  await sleep(throughputSeconds * 1000);
  const seconds = (now() - start) / 1000;
  const after = await cpuTicks(shell);
  stop();
  const cpu = new Map<string, number>();
  for (const [name, ticks] of after) {
    // 100 clock ticks a second, as a share of one core.
    cpu.set(name, ((ticks - (before.get(name) ?? ticks)) / 100 / seconds) * 100);
  }
  if (process.env.ANVIA_BENCH_DEBUG) {
    console.log(
      `  ${updates} updates, ${(bytes / Math.max(1, updates) / 1024).toFixed(0)} KiB each`,
    );
  }
  return { mbPerSecond: bytes / seconds / 1e6, updatesPerSecond: updates / seconds, cpu };
}

// ---- the run ------------------------------------------------------------------------------------
interface Row {
  path: string;
  latencyMedian: number;
  latencyP95: number;
  latencyMin: number;
  samples: number;
  throughput: Throughput;
  /** The same flood with only Raw offered: a stress test of the transport, not of the encoder. */
  raw: Throughput;
}

const daemonToken = randomBytes(24).toString("base64url");
const tickets = new Set<string>();
const hub = new RemoteSandboxHub({
  authorize: (token) => (token === daemonToken ? { sandboxId } : null),
  authorizeDesktop: (request) => {
    const ticket = relayTicket(request);
    return ticket !== undefined && tickets.delete(ticket) ? { sandboxId, readOnly: true } : null;
  },
  connectTimeoutMs: 120_000,
  allowedOrigins: [],
});
const { port: hubPort } = await hub.listen({
  host: "127.0.0.1",
  path: "/daemon",
  desktopPath: "/desktop",
});
const proxy = new DelayProxy(hubPort);
const proxyPort = await proxy.listen();

const containerName = `anvia-bench-${process.pid}`;
const container = spawn(
  "docker",
  [
    "run",
    "--rm",
    `--name=${containerName}`,
    "--add-host=host.docker.internal:host-gateway",
    `--env=ANVIA_CONTROL_URL=ws://host.docker.internal:${proxyPort}/daemon`,
    `--env=ANVIA_SANDBOX_TOKEN=${daemonToken}`,
    image,
  ],
  { stdio: ["ignore", "ignore", "inherit"] },
);
const rows: Row[] = [];
let shell: Shell | undefined;

const cleanup = async () => {
  shell?.close();
  spawn("docker", ["rm", "-f", containerName], { stdio: "ignore" });
  container.kill();
  proxy.close();
  await hub.close();
};
process.once("SIGINT", () => void cleanup().then(() => process.exit(130)));

try {
  console.log(`Starting ${image}...`);
  const desktop = hub.desktop(sandboxId);
  const status = await desktop.start();
  console.log(`Desktop up at ${status.width}x${status.height}; VNC on ${status.vncPort}.`);
  shell = new Shell(containerName);

  // Two terminals: a small one to move around (latency), and a maximized one that scrolls random
  // text as fast as it can (throughput).
  await shell.run(
    `lxterminal --geometry=60x14 -e sh -c 'sleep 100000' >/dev/null 2>&1 & sleep 3; echo ok`,
  );
  const windowId = (
    await shell.run(`xdotool search --onlyvisible --class lxterminal | tail -1`)
  ).trim();
  if (windowId === "") throw new Error("No terminal window to move.");

  const runCase = async (path: string, makeClient: (encodings?: number[]) => RfbClient) => {
    const client = makeClient();
    await client.connect();
    client.startRequesting();
    await settle(client, 800);
    const samples = await measureLatency(client, shell as Shell, windowId);

    // Flood the screen with a maximized terminal printing random text, then measure.
    const shellRef = shell as Shell;
    shellRef.fire(`lxterminal --geometry=200x50 -e sh -c 'base64 /dev/urandom' >/dev/null 2>&1 &`);
    await sleep(2500);
    const flood = (
      await shellRef.run(`xdotool search --onlyvisible --class lxterminal | tail -1`)
    ).trim();
    await shellRef.run(
      `xdotool windowmove ${flood} 0 0 windowsize ${flood} ${status.width} ${status.height - 80}`,
    );
    await sleep(1000);
    if (process.env.ANVIA_BENCH_DEBUG) {
      const shot = await desktop.screenshot();
      await (await import("node:fs/promises")).writeFile("/tmp/anvia-bench-flood.png", shot.png);
    }
    const throughput = await measureThroughput(client, shellRef);
    if (process.env.ANVIA_BENCH_DEBUG) console.log([...throughput.cpu].join(" "));
    client.close();
    await sleep(500);

    // Same flood, Raw only: every changed region crosses the link uncompressed.
    const rawClient = makeClient([encodingRaw]);
    await rawClient.connect();
    rawClient.startRequesting();
    await sleep(1000);
    const raw = await measureThroughput(rawClient, shellRef);
    rawClient.close();
    shellRef.fire(`pkill -f 'base64 /dev/urandom'`);
    await sleep(500);
    rows.push({
      path,
      latencyMedian: percentile(samples, 50),
      latencyP95: percentile(samples, 95),
      latencyMin: samples[0] ?? Number.NaN,
      samples: samples.length,
      throughput,
      raw,
    });
    console.log(`  measured ${path}`);
  };

  if (!skipDirect)
    await runCase(
      "direct (in the container)",
      (encodings) => new RfbClient(directTransport(containerName, status.vncPort), encodings),
    );
  for (const rtt of rtts) {
    proxy.oneWayMs = rtt / 2;
    await runCase(`relay, RTT ${rtt} ms`, (encodings) => {
      const ticket = randomBytes(16).toString("base64url");
      tickets.add(ticket);
      return new RfbClient(relayTransport(`ws://127.0.0.1:${hubPort}/desktop`, ticket), encodings);
    });
  }
  proxy.oneWayMs = 0;

  const ms = (value: number) => `${value.toFixed(0)} ms`;
  const cpu = (row: Row, name: string) => {
    const value = row.throughput.cpu.get(name);
    return value === undefined || Number.isNaN(value) ? "-" : `${value.toFixed(0)}%`;
  };
  const present = (row: Row, name: string) => row.throughput.cpu.has(name);
  console.log(`\nDesktop benchmark: ${label}  (${image}, ${status.width}x${status.height})\n`);
  console.log(
    "| path | update latency median / p95 / min | ZRLE flood: MB/s (updates/s) | Raw flood: MB/s (updates/s) | daemon CPU | VNC server CPU | X server CPU |",
  );
  console.log("|---|---|---|---|---|---|---|");
  for (const row of rows) {
    const vnc = present(row, "Xvnc") ? cpu(row, "Xvnc") : cpu(row, "x11vnc");
    const xserver = present(row, "Xvnc") ? "(Xvnc, same process)" : cpu(row, "Xvfb");
    console.log(
      `| ${row.path} | ${ms(row.latencyMedian)} / ${ms(row.latencyP95)} / ${ms(row.latencyMin)} (n=${row.samples}) | ${row.throughput.mbPerSecond.toFixed(2)} (${row.throughput.updatesPerSecond.toFixed(0)}) | ${row.raw.mbPerSecond.toFixed(1)} (${row.raw.updatesPerSecond.toFixed(1)}) | ${cpu(row, "node")} | ${vnc} | ${xserver} |`,
    );
  }
  console.log(
    "\nLatency includes starting xdotool (about the same in every row). CPU is a share of one core, during the ZRLE flood.",
  );
} finally {
  await cleanup();
  process.exit(process.exitCode ?? 0);
}
