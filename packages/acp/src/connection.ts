import type { AcpConnection, AcpConnectionOptions } from "./types.js";
import { createV1Stream } from "./wire/stream.js";
import { connectV1 } from "./wire/v1.js";
import { SessionManager } from "./session-manager.js";

/** Connect a stable ACP v1 agent to caller-supplied byte streams without process side effects. */
export function createAcpConnection(options: AcpConnectionOptions): AcpConnection {
  if (typeof options.sessionFactory !== "function") {
    throw new TypeError("An ACP sessionFactory is required.");
  }
  const sessions = new SessionManager(options);
  const connection = connectV1(createV1Stream(options), sessions, options);
  const closed = connection.closed.then(() => sessions.close());
  return {
    closed,
    async close() {
      connection.close();
      await sessions.close();
      await closed;
    },
  };
}
