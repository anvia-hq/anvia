import { type StreamChannelLimits, StreamChannel } from "../stream-channel";
import type { DaemonOutbound } from "../../remote/binary-frame";
import { type DaemonFrame, encodeBytes } from "../../remote/protocol";
import type { TerminalAttachment, TerminalExitInfo } from "./attachments";

export type PtyChannelLimits = StreamChannelLimits;

/** A terminal viewer's output channel: the shared stream channel with `pty.*` frames. */
export class PtyChannel extends StreamChannel<TerminalExitInfo> {
  constructor(
    ptyId: string,
    attachment: TerminalAttachment,
    io: { send: (frame: DaemonOutbound) => void; bufferedAmount: () => number },
    limits?: PtyChannelLimits,
  ) {
    super(
      attachment,
      {
        output: (seq, bytes) => ({ type: "pty.output", ptyId, seq, data: encodeBytes(bytes) }),
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
