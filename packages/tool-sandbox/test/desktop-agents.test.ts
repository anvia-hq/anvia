import { spawn, type ChildProcess } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  desktopSessionVariable,
  findDesktopAgents,
  stopDesktopAgents,
} from "../src/daemon/desktop/agents";
import { type DesktopSupervisorOptions, DesktopSupervisor } from "../src/daemon/desktop/supervisor";

// Fake agents: shell scripts named like the real ones. Each loop iteration is short, so nothing
// outlives the test even when the script is killed without its trap running.
const agentScript = (trap: string) => `#!/bin/sh\n${trap}\nwhile :; do sleep 0.1; done\n`;
const exitsOnTerm = agentScript("trap 'exit 0' TERM");
const ignoresTerm = agentScript("trap '' TERM");

let dir: string;
const children: ChildProcess[] = [];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "desktop-agents-"));
  await mkdir(join(dir, "bin"));
});

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
  await rm(dir, { recursive: true, force: true });
});

async function fakeProgram(name: string, body: string): Promise<string> {
  const file = join(dir, "bin", name);
  await writeFile(file, body);
  await chmod(file, 0o755);
  return file;
}

/** Start a fake program with the given desktop session id in its environment (or none). */
function start(file: string, session: string | undefined): ChildProcess {
  const env: Record<string, string> = { PATH: process.env.PATH ?? "/usr/bin:/bin" };
  if (session !== undefined) env[desktopSessionVariable] = session;
  const child = spawn(file, [], { env, stdio: "ignore" });
  children.push(child);
  return child;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(condition: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition() && Date.now() < deadline) {
    await sleep(20);
  }
}

const exited = (child: ChildProcess) => child.exitCode !== null || child.signalCode !== null;

describe("stopDesktopAgents", () => {
  it("stops the agents of one desktop and leaves other agents and programs alone", async () => {
    const agent = await fakeProgram("ssh-agent", exitsOnTerm);
    const gpg = await fakeProgram("gpg-agent", exitsOnTerm);
    const helper = await fakeProgram("xdg-helper", exitsOnTerm);
    const session = "desktop-a";

    const ours = [start(agent, session), start(gpg, session)];
    const otherDesktop = start(agent, "desktop-b");
    const userAgent = start(agent, undefined);
    const notAnAgent = start(helper, session);
    // Let each script reach its loop, so the signal lands after the trap is installed.
    await sleep(500);

    await stopDesktopAgents(session, { graceMs: 2_000 });

    for (const child of ours) expect(exited(child)).toBe(true);
    expect(exited(otherDesktop)).toBe(false);
    expect(exited(userAgent)).toBe(false);
    expect(exited(notAnAgent)).toBe(false);
  });

  it("kills an agent that ignores SIGTERM after the grace period", async () => {
    const agent = await fakeProgram("ssh-agent", ignoresTerm);
    const session = "desktop-stubborn";
    const child = start(agent, session);
    await sleep(500);

    await stopDesktopAgents(session, { graceMs: 200 });

    await waitFor(() => exited(child));
    expect(child.signalCode).toBe("SIGKILL");
  });

  it("does nothing when no agent of the session is running", async () => {
    await expect(stopDesktopAgents("nothing-here")).resolves.toBeUndefined();
  });
});

describe("DesktopSupervisor.stop", () => {
  const supervisorOptions = (): DesktopSupervisorOptions => ({
    backend: "xvfb",
    binaries: { xdotool: "xdotool", xrandr: "xrandr", import: "import" },
    windowManager: undefined,
    resolution: { width: 1280, height: 800 },
    maxResolution: { width: 1280, height: 800 },
    display: ":98",
    vncPort: 5998,
    startTimeoutMs: 1_000,
    restart: {},
    env: () => ({ PATH: process.env.PATH ?? "/usr/bin:/bin" }),
    log: () => undefined,
  });

  it("gives each desktop its own session id for its programs", () => {
    const first = new DesktopSupervisor(supervisorOptions()).environment();
    const second = new DesktopSupervisor(supervisorOptions()).environment();
    expect(first[desktopSessionVariable]).toMatch(/^[0-9a-f]{24}$/);
    expect(first[desktopSessionVariable]).not.toBe(second[desktopSessionVariable]);
    expect(first.DISPLAY).toBe(":98");
  });

  it("stops an agent started with the desktop's environment, when the desktop stops", async () => {
    const supervisor = new DesktopSupervisor(supervisorOptions());
    const agent = await fakeProgram("ssh-agent", exitsOnTerm);
    // What an autostart does: a program started with the desktop's environment, which daemonizes.
    const child = spawn(agent, [], { env: supervisor.environment(), stdio: "ignore" });
    children.push(child);
    await sleep(500);

    await supervisor.stop();

    await waitFor(() => exited(child));
    expect(exited(child)).toBe(true);
  });
});

describe("findDesktopAgents", () => {
  it("matches the exact session id, by name, in a process table", async () => {
    const proc = join(dir, "proc");
    const entry = async (pid: string, comm: string, environ: string[]) => {
      await mkdir(join(proc, pid), { recursive: true });
      await writeFile(join(proc, pid, "comm"), `${comm}\n`);
      await writeFile(join(proc, pid, "environ"), environ.map((v) => `${v}\0`).join(""));
    };
    await entry("100", "ssh-agent", [`${desktopSessionVariable}=abc`]);
    await entry("101", "gpg-agent", [`${desktopSessionVariable}=abc`, "HOME=/h"]);
    await entry("102", "ssh-agent", [`${desktopSessionVariable}=abcd`]); // A longer id: no match.
    await entry("103", "sleep", [`${desktopSessionVariable}=abc`]); // Not an agent.
    await entry("104", "ssh-agent", ["HOME=/h"]); // No marker.
    await entry("self", "ssh-agent", [`${desktopSessionVariable}=abc`]); // Not a pid.

    expect(await findDesktopAgents("abc", proc)).toEqual([
      { pid: 100, name: "ssh-agent" },
      { pid: 101, name: "gpg-agent" },
    ]);
  });

  it("finds nothing where there is no process table", async () => {
    expect(await findDesktopAgents("abc", join(dir, "missing"))).toEqual([]);
  });
});
