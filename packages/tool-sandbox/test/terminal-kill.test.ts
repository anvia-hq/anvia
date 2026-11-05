import { afterEach, describe, expect, it, vi } from "vitest";
import { ShellSession, ShellViewer, hangupGraceMs } from "../src/daemon/terminal/attachments";
import { type FakePty, fakeSpawner } from "./support/fake-pty";

afterEach(() => {
  vi.useRealTimers();
});

function openSession() {
  const { spawn, ptys } = fakeSpawner();
  spawn({ file: "/bin/sh", args: [], cwd: "/", env: {}, cols: 80, rows: 24 });
  const pty = ptys[0] as FakePty;
  const session = new ShellSession("s", pty, 1024, () => undefined);
  const exits: unknown[] = [];
  const viewer = new ShellViewer(session, false, () => undefined);
  viewer.start({ onData: () => undefined, onExit: (info) => exits.push(info) });
  return { pty, session, exits };
}

describe("killing a shell session", () => {
  it("sends SIGHUP only when the shell exits on it", async () => {
    vi.useFakeTimers();
    const { pty, session, exits } = openSession();

    session.kill();
    expect(exits).toEqual([{ reason: "killed" }]);
    await vi.advanceTimersByTimeAsync(hangupGraceMs * 2);
    expect(pty.signals).toEqual(["SIGHUP"]);
  });

  it("sends SIGKILL when a shell ignores SIGHUP past the grace period", async () => {
    vi.useFakeTimers();
    const { pty, session, exits } = openSession();
    pty.ignoreHangup = true;

    session.kill();
    await vi.advanceTimersByTimeAsync(hangupGraceMs - 1);
    expect(exits).toEqual([]);
    expect(pty.signals).toEqual(["SIGHUP"]);

    await vi.advanceTimersByTimeAsync(1);
    expect(pty.signals).toEqual(["SIGHUP", "SIGKILL"]);
    expect(exits).toEqual([{ reason: "killed" }]);
  });

  it("does nothing more once the session is killed", () => {
    vi.useFakeTimers();
    const { pty, session } = openSession();

    session.kill();
    session.kill();
    vi.advanceTimersByTime(hangupGraceMs * 2);
    expect(pty.signals).toEqual(["SIGHUP"]);
  });
});
