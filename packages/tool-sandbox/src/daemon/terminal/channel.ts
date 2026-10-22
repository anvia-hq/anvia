import { type StreamChannelLimits, StreamChannel } from "../stream-channel";
import type { DaemonFrame } from "../../remote/protocol";
import type { TerminalAttachment, TerminalExitInfo } from "./attachments";

export type PtyChannelLimits = StreamChannelLimits;

/** A terminal viewer's output channel: the shared stream channel with `pty.*` frames. */
export class PtyChannel extends StreamChannel<TerminalExitInfo> {
  constructor(
    ptyId: string,
    attachment: TerminalAttachment,
    io: { send: (frame: DaemonFrame) => void; bufferedAmount: () => number },
    limits?: PtyChannelLimits,
  ) {
    super(
      attachment,
      {
        output: (seq, data) => ({ type: "pty.output", ptyId, seq, data }),
        exit: (info) => {
          const frame: DaemonFrame = { type: "pty.exit", ptyId, reason: info.reason };
          return info.exitCode === undefined ? frame : { ...frame, exitCode: info.exitCode };
        },
      },
      io,
      limits,
    );
  }
}
