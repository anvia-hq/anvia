import type { DaemonOutbound } from "../remote/binary-frame";
import type { DaemonFrame } from "../remote/protocol";

export interface StreamChannelLimits {
  /** Coalescing window for output. Default 10 ms. */
  batchMs?: number | undefined;
  /** Largest `pty.output` frame, in raw bytes. Default 16 KiB. */
  frameBytes?: number | undefined;
  /** Unacked plus unsent bytes above which the PTY is paused. Default 256 KiB. */
  highWaterBytes?: number | undefined;
  /** Socket send buffer above which no more output is queued. Default 1 MiB. */
  socketBufferBytes?: number | undefined;
}

const defaultBatchMs = 10;
const defaultFrameBytes = 16 * 1024;
const defaultHighWaterBytes = 256 * 1024;
const defaultSocketBufferBytes = 1024 * 1024;
/** Sent to a viewer that fell behind, ahead of the snapshot, to wipe what it has half-drawn. */
const resetTerminal = new Uint8Array([0x1b, 0x63]);

/** What a channel needs from the thing producing its bytes (a PTY attachment, a TCP socket). */
export interface StreamSource {
  /**
   * True when pausing only stalls this consumer. False when the source is shared and must keep
   * draining, so a slow consumer is resynchronised from a snapshot instead.
   */
  readonly pausable: boolean;
  pause(): void;
  resume(): void;
  /** Bytes that redraw the stream from scratch, for a consumer that fell behind. */
  snapshot(): Uint8Array | undefined;
}

/** How a channel's frames look on the wire, which is all that differs between users of it. */
export interface StreamFrames<Exit> {
  /** The frame for one run of output. Putting bytes on the wire (base64 or not) is the frame's. */
  output(seq: number, bytes: Uint8Array): DaemonOutbound;
  exit(info: Exit): DaemonFrame;
}

/**
 * Sends one source's output to the hub in order, and keeps it from outrunning the consumer.
 *
 * Output is batched, framed, and numbered. The hub acknowledges consumed bytes; once the bytes in
 * flight plus those waiting to be sent pass the high-water mark, a pausable source is paused
 * (the child blocks and tmux skips ahead) and resumed when the consumer catches up. A shared
 * source cannot be paused (a PTY shared by every viewer), so it goes stale instead: it drops what it cannot send and, as
 * soon as the consumer has room again, sends a reset plus a snapshot of the session. Either way
 * memory stays bounded by the high-water mark.
 */
export class StreamChannel<Exit> {
  private readonly batchMs: number;
  private readonly frameBytes: number;
  private readonly highWater: number;
  private readonly lowWater: number;
  private readonly socketBufferBytes: number;
  private pending: Uint8Array[] = [];
  private pendingBytes = 0;
  private seq = 0;
  private sentBytes = 0;
  private ackedBytes = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private paused = false;
  private stale = false;
  private finished = false;

  constructor(
    private readonly source: StreamSource,
    private readonly frames: StreamFrames<Exit>,
    private readonly io: {
      send: (frame: DaemonOutbound) => void;
      bufferedAmount: () => number;
    },
    limits: StreamChannelLimits = {},
  ) {
    this.batchMs = limits.batchMs ?? defaultBatchMs;
    this.frameBytes = limits.frameBytes ?? defaultFrameBytes;
    this.highWater = limits.highWaterBytes ?? defaultHighWaterBytes;
    this.lowWater = Math.floor(this.highWater / 2);
    this.socketBufferBytes = limits.socketBufferBytes ?? defaultSocketBufferBytes;
  }

  get inFlightBytes(): number {
    return this.sentBytes - this.ackedBytes;
  }

  push(chunk: Uint8Array): void {
    if (this.finished || this.stale) return;
    this.pending.push(chunk);
    this.pendingBytes += chunk.byteLength;
    if (this.pendingBytes + this.inFlightBytes > this.highWater) {
      if (this.source.pausable) {
        if (!this.paused) {
          this.paused = true;
          this.source.pause();
        }
      } else {
        // The PTY is shared and keeps running, so give up on this viewer's backlog. The next
        // flush with room to spare replaces it with a snapshot.
        this.stale = true;
        this.pending = [];
        this.pendingBytes = 0;
      }
    }
    this.schedule();
  }

  /** The hub consumed `bytes` of output in total. */
  ack(bytes: number): void {
    if (this.finished) return;
    this.ackedBytes = Math.max(this.ackedBytes, Math.min(bytes, this.sentBytes));
    const backlog = this.pendingBytes + this.inFlightBytes;
    if (this.paused && backlog <= this.lowWater) {
      this.paused = false;
      this.source.resume();
    }
    if (this.stale || this.pendingBytes > 0) this.schedule();
  }

  /** Flush what is queued and report the end, in that order. */
  finish(info: Exit): void {
    if (this.finished) return;
    this.flush(true);
    this.finished = true;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.io.send(this.frames.exit(info));
  }

  dispose(): void {
    this.finished = true;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.pending = [];
    this.pendingBytes = 0;
  }

  /** Replace what a stale viewer missed with the session as it is now. */
  private resync(): void {
    this.stale = false;
    const full = this.source.snapshot();
    if (full === undefined) return;
    // Cut to half the window so the whole snapshot goes out in one flight.
    const snapshot = full.subarray(Math.max(0, full.byteLength - this.lowWater));
    this.pending = [resetTerminal, snapshot];
    this.pendingBytes = resetTerminal.byteLength + snapshot.byteLength;
  }

  private schedule(): void {
    if (this.timer !== undefined || this.finished) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.flush(false);
    }, this.batchMs);
    this.timer.unref?.();
  }

  private flush(force: boolean): void {
    if (this.stale && this.inFlightBytes <= this.lowWater) this.resync();
    if (this.pendingBytes === 0) return;
    if (!force && this.io.bufferedAmount() > this.socketBufferBytes) {
      this.schedule();
      return;
    }
    const merged = new Uint8Array(this.pendingBytes);
    let offset = 0;
    for (const chunk of this.pending) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    this.pending = [];
    this.pendingBytes = 0;

    let start = 0;
    while (start < merged.byteLength) {
      if (!force && this.inFlightBytes >= this.highWater) break;
      const end = Math.min(merged.byteLength, start + this.frameBytes);
      const slice = merged.subarray(start, end);
      this.sentBytes += slice.byteLength;
      this.io.send(this.frames.output(this.seq++, slice));
      start = end;
    }
    if (start < merged.byteLength) {
      // Held back by flow control; ack() sends it.
      this.pending = [merged.subarray(start)];
      this.pendingBytes = merged.byteLength - start;
    }
  }
}
