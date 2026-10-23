import { DockerSandboxError } from "../../errors";
import type { DaemonOutbound } from "../../remote/binary-frame";
import { type HubFrame, decodeBytes, encodeError } from "../../remote/protocol";
import type { LocalSandbox } from "../local-sandbox";
import type { TerminalAttachment } from "./attachments";
import { PtyChannel } from "./channel";
import type { TerminalManager } from "./manager";
import type { SandboxDaemonTerminalOptions } from "./options";

const defaultMaxAttachments = 16;

interface Entry {
  closing: boolean;
  attachment?: TerminalAttachment;
  channel?: PtyChannel;
}

/**
 * The terminals one hub connection has open. They belong to the connection: when it closes, every
 * attachment is detached (a tmux session itself keeps running).
 */
export class ConnectionTerminals {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly deps: {
      terminals: TerminalManager | undefined;
      sandbox: LocalSandbox;
      options: SandboxDaemonTerminalOptions | undefined;
      send: (frame: DaemonOutbound) => void;
      bufferedAmount: () => number;
    },
  ) {}

  /** The manager, or the typed error a daemon without terminals gives. */
  require(): TerminalManager {
    if (this.deps.terminals === undefined) {
      throw new DockerSandboxError("This sandbox has no terminal support.", "unsupported");
    }
    return this.deps.terminals;
  }

  async open(frame: Extract<HubFrame, { type: "pty.open" }>): Promise<void> {
    const { ptyId } = frame;
    const fail = (error: unknown) => this.deps.send(encodeError(error, ptyId));
    let terminals: TerminalManager;
    try {
      terminals = this.require();
    } catch (error) {
      fail(error);
      return;
    }
    const maxAttachments = this.deps.options?.maxAttachments ?? defaultMaxAttachments;
    if (this.entries.has(ptyId) || this.entries.size >= maxAttachments) {
      fail(
        new DockerSandboxError(
          this.entries.has(ptyId)
            ? `Terminal ${ptyId} is already open.`
            : `Too many open terminals (${maxAttachments}).`,
          "invalid_state",
        ),
      );
      return;
    }
    const entry: Entry = { closing: false };
    this.entries.set(ptyId, entry);
    try {
      const context = await this.deps.sandbox.terminalContext(frame.cwd, frame.env);
      const attachment = await terminals.open({
        sessionName: frame.sessionName,
        cols: frame.cols,
        rows: frame.rows,
        cwd: context.cwd,
        env: context.env,
        readOnly: frame.readOnly === true,
      });
      if (entry.closing) {
        attachment.close();
        return;
      }
      const channel = new PtyChannel(
        ptyId,
        attachment,
        { send: this.deps.send, bufferedAmount: this.deps.bufferedAmount },
        this.deps.options?.flow,
      );
      entry.attachment = attachment;
      entry.channel = channel;
      this.deps.send({ type: "pty.opened", ptyId });
      attachment.start({
        onData: (chunk) => channel.push(chunk),
        onExit: (info) => {
          this.entries.delete(ptyId);
          channel.finish(info);
        },
      });
    } catch (error) {
      this.entries.delete(ptyId);
      if (!entry.closing) fail(error);
    }
  }

  input(ptyId: string, data: string): void {
    this.entries.get(ptyId)?.attachment?.write(decodeBytes(data));
  }

  resize(ptyId: string, cols: number, rows: number): void {
    this.entries.get(ptyId)?.attachment?.resize(cols, rows);
  }

  ack(ptyId: string, bytes: number): void {
    this.entries.get(ptyId)?.channel?.ack(bytes);
  }

  close(ptyId: string): void {
    const entry = this.entries.get(ptyId);
    if (entry === undefined) return;
    this.entries.delete(ptyId);
    this.detach(entry);
  }

  /** The connection is gone: detach everything. */
  dispose(): void {
    const entries = Array.from(this.entries.values());
    this.entries.clear();
    for (const entry of entries) this.detach(entry);
  }

  private detach(entry: Entry): void {
    entry.closing = true;
    entry.channel?.dispose();
    entry.attachment?.close();
  }
}
