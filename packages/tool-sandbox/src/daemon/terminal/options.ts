import type { PtyChannelLimits } from "./channel";
import type { PtySpawner } from "./pty";

export interface SandboxDaemonTerminalOptions {
  /** PTY implementation. Defaults to `node-pty` when the image installed it. */
  spawn?: PtySpawner;
  /** tmux binary to use, or false to force the plain-shell fallback. Default: `tmux` on PATH. */
  tmuxPath?: string | false;
  /** tmux server socket name. Default `anvia-sandbox`. */
  socketName?: string;
  /** Scrollback the plain-shell fallback keeps per session. Default 256 KiB. */
  scrollbackBytes?: number;
  /** Terminal sessions allowed at once. Default 16. */
  maxSessions?: number;
  /** Terminal attachments one hub connection may hold open. Default 16. */
  maxAttachments?: number;
  /** Output batching and flow-control bounds. */
  flow?: PtyChannelLimits;
}
