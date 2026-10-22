import { describe, expect, it } from "vitest";
import { PtyChannel } from "../src/daemon/terminal/channel";
import type { TerminalAttachment } from "../src/daemon/terminal/attachments";
import { type DaemonFrame, decodeBytes } from "../src/remote/protocol";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function setup(options: { pausable: boolean; snapshot?: Uint8Array; bufferedAmount?: number }) {
  const frames: DaemonFrame[] = [];
  const calls = { pause: 0, resume: 0 };
  const attachment: TerminalAttachment = {
    pausable: options.pausable,
    start: () => undefined,
    write: () => undefined,
    resize: () => undefined,
    pause: () => void (calls.pause += 1),
    resume: () => void (calls.resume += 1),
    snapshot: () => options.snapshot,
    close: () => undefined,
  };
  const state = { buffered: options.bufferedAmount ?? 0 };
  const channel = new PtyChannel(
    "p1",
    attachment,
    { send: (frame) => frames.push(frame), bufferedAmount: () => state.buffered },
    { batchMs: 1, frameBytes: 1_000, highWaterBytes: 10_000 },
  );
  const outputs = () =>
    frames.filter((frame): frame is Extract<DaemonFrame, { type: "pty.output" }> => {
      return frame.type === "pty.output";
    });
  const sentBytes = () =>
    outputs().reduce((total, frame) => total + decodeBytes(frame.data).byteLength, 0);
  return { channel, frames, calls, outputs, sentBytes, state };
}

describe("PtyChannel", () => {
  it("batches small chunks into ordered frames", async () => {
    const { channel, outputs } = setup({ pausable: true });
    for (let index = 0; index < 50; index += 1) channel.push(new TextEncoder().encode("ab"));
    await sleep(20);
    const frames = outputs();
    expect(frames).toHaveLength(1);
    expect(frames[0]?.seq).toBe(0);
    expect(new TextDecoder().decode(decodeBytes(frames[0]?.data ?? ""))).toBe("ab".repeat(50));
  });

  it("splits large output into numbered frames of bounded size", async () => {
    const { channel, outputs } = setup({ pausable: true });
    channel.push(new Uint8Array(3_500));
    await sleep(20);
    expect(outputs().map((frame) => frame.seq)).toEqual([0, 1, 2, 3]);
    expect(outputs().every((frame) => decodeBytes(frame.data).byteLength <= 1_000)).toBe(true);
  });

  it("pauses a pausable PTY at the high-water mark and resumes once acked", async () => {
    const { channel, calls, sentBytes } = setup({ pausable: true });
    // An unread consumer: nothing is acked, so the PTY is paused near the high-water mark. A
    // paused PTY produces nothing more, so stop feeding once it is.
    for (let index = 0; index < 200 && calls.pause === 0; index += 1) {
      channel.push(new Uint8Array(1_000));
      await sleep(1);
    }
    await sleep(20);
    expect(calls.pause).toBe(1);
    expect(sentBytes()).toBeLessThanOrEqual(10_000 + 1_000);
    expect(calls.resume).toBe(0);

    channel.ack(sentBytes());
    expect(calls.resume).toBe(1);
  });

  it("holds output back instead of buffering without bound while unacked", async () => {
    const { channel, sentBytes } = setup({ pausable: true });
    channel.push(new Uint8Array(40_000));
    await sleep(20);
    expect(sentBytes()).toBeLessThanOrEqual(11_000);
    // Acking releases the held-back remainder.
    channel.ack(sentBytes());
    await sleep(20);
    expect(sentBytes()).toBeGreaterThan(11_000);
  });

  it("keeps a shared PTY running and replays a snapshot after a viewer catches up", async () => {
    const snapshot = new TextEncoder().encode("SNAPSHOT");
    const { channel, calls, outputs, sentBytes } = setup({ pausable: false, snapshot });
    for (let index = 0; index < 100; index += 1) {
      channel.push(new Uint8Array(1_000));
      await sleep(1);
    }
    expect(calls.pause).toBe(0);
    const stalledAt = sentBytes();
    expect(stalledAt).toBeLessThanOrEqual(11_000);

    channel.ack(stalledAt);
    await sleep(20);
    const resync = outputs()
      .slice(-2)
      .map((frame) => decodeBytes(frame.data));
    const text = new TextDecoder().decode(Uint8Array.from(resync.flatMap((bytes) => [...bytes])));
    expect(text).toContain("\x1bcSNAPSHOT");
  });

  it("recovers a shared viewer whose very first batch overflows the window", async () => {
    // No output was ever sent, so no ack can arrive; the channel must resync on its own.
    const snapshot = new TextEncoder().encode("FIRST-SCREEN");
    const { channel, outputs } = setup({ pausable: false, snapshot });
    channel.push(new Uint8Array(50_000));
    await sleep(30);
    const text = new TextDecoder().decode(
      Uint8Array.from(outputs().flatMap((frame) => [...decodeBytes(frame.data)])),
    );
    expect(text).toBe("\x1bcFIRST-SCREEN");
  });

  it("waits while the socket is backed up", async () => {
    const { channel, outputs, state } = setup({ pausable: true, bufferedAmount: 5_000_000 });
    channel.push(new TextEncoder().encode("x"));
    await sleep(20);
    expect(outputs()).toHaveLength(0);
    state.buffered = 0;
    await sleep(20);
    expect(outputs()).toHaveLength(1);
  });

  it("flushes pending output before reporting the exit", () => {
    const { channel, frames } = setup({ pausable: true });
    channel.push(new TextEncoder().encode("bye"));
    channel.finish({ reason: "exited", exitCode: 2 });
    expect(frames.map((frame) => frame.type)).toEqual(["pty.output", "pty.exit"]);
    expect(frames[1]).toMatchObject({ reason: "exited", exitCode: 2 });
  });
});
