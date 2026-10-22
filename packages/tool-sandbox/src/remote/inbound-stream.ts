import { DockerSandboxError } from "../errors";

export interface InboundStreamOptions<End> {
  /** Unread bytes allowed before the stream is cut off. */
  maxBufferBytes: number;
  /** The reader consumed this many bytes in total. Tell the sender, so it can send more. */
  onConsumed: (totalBytes: number) => void;
  /** The sender ignored flow control. Release whatever the stream holds on the link. */
  onOverflow: () => void;
  /** How the stream ends when it overflows. */
  overflowEnd: End;
  /** Names the stream in the error a reader sees when it overflows. */
  label: string;
}

/**
 * The receiving end of one flow-controlled stream (a terminal's output, a tunnel's data): a bounded
 * queue and a single-use async iterator. The sender is told about bytes only once the reader asks
 * for more, so a slow reader slows the sender instead of growing memory here.
 */
export class InboundStream<End> {
  /** Read it once. */
  readonly chunks: AsyncGenerator<Uint8Array, void, void> = this.read();
  /** Settles when the stream ends. It never rejects. */
  readonly ended: Promise<End>;
  private readonly queue: Uint8Array[] = [];
  private queued = 0;
  private consumed = 0;
  private acknowledged = 0;
  private finished: End | undefined;
  private failure: Error | undefined;
  private wake: (() => void) | undefined;
  private resolveEnded!: (end: End) => void;

  constructor(private readonly options: InboundStreamOptions<End>) {
    this.ended = new Promise((resolve) => {
      this.resolveEnded = resolve;
    });
  }

  get endedWith(): End | undefined {
    return this.finished;
  }

  push(data: Uint8Array): void {
    if (this.finished !== undefined) return;
    if (this.queued + data.byteLength > this.options.maxBufferBytes) {
      // The sender honours acks, so this is a peer ignoring flow control or a reader that stopped.
      this.failure = new DockerSandboxError(
        `${this.options.label} consumer is too slow.`,
        "protocol",
      );
      this.options.onOverflow();
      this.end(this.options.overflowEnd);
      return;
    }
    this.queue.push(data);
    this.queued += data.byteLength;
    this.signal();
  }

  end(info: End): void {
    if (this.finished !== undefined) return;
    this.finished = info;
    this.resolveEnded(info);
    this.signal();
  }

  private async *read(): AsyncGenerator<Uint8Array, void, void> {
    while (true) {
      this.acknowledge();
      const chunk = this.queue.shift();
      if (chunk !== undefined) {
        this.queued -= chunk.byteLength;
        this.consumed += chunk.byteLength;
        yield chunk;
        continue;
      }
      if (this.failure !== undefined) throw this.failure;
      if (this.finished !== undefined) return;
      await new Promise<void>((resolve) => {
        this.wake = resolve;
      });
    }
  }

  /** Report consumption once the reader has asked for more, i.e. after it handled the last chunk. */
  private acknowledge(): void {
    if (this.consumed === this.acknowledged || this.finished !== undefined) return;
    this.acknowledged = this.consumed;
    this.options.onConsumed(this.consumed);
  }

  private signal(): void {
    const wake = this.wake;
    this.wake = undefined;
    wake?.();
  }
}
