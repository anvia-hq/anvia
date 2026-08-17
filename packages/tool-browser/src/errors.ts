export type BrowserErrorCode =
  | "connection_closed"
  | "human_controlled"
  | "invalid_state"
  | "navigation_blocked"
  | "not_ready"
  | "startup_failed";

export class BrowserError extends Error {
  constructor(
    message: string,
    readonly code: BrowserErrorCode,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "BrowserError";
  }
}
