import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import WebSocket, { type WebSocketServer } from "ws";

const ticketPrefix = "anvia.ticket.";

/**
 * Pull a short-lived ticket out of a browser relay upgrade request. Browsers cannot set an
 * `Authorization` header on a WebSocket, so the ticket travels in the `ticket` query parameter or
 * as an `anvia.ticket.<ticket>` entry of `Sec-WebSocket-Protocol`. Prefer the latter: URLs end up
 * in access logs. Terminal and tunnel relays read it the same way.
 */
export function relayTicket(request: IncomingMessage): string | undefined {
  const header = request.headers["sec-websocket-protocol"];
  const offered = (Array.isArray(header) ? header.join(",") : (header ?? ""))
    .split(",")
    .map((entry) => entry.trim());
  for (const entry of offered) {
    if (entry.startsWith(ticketPrefix) && entry.length > ticketPrefix.length) {
      return entry.slice(ticketPrefix.length);
    }
  }
  const ticket = new URL(request.url ?? "/", "http://hub").searchParams.get("ticket");
  return ticket === null || ticket === "" ? undefined : ticket;
}

/**
 * Cross-site WebSocket hijacking guard. A request with no Origin is not from a browser page and
 * passes. Otherwise the Origin must be listed, or, with no list, must be the host that was asked.
 */
export function originAllowed(
  request: IncomingMessage,
  allowedOrigins: readonly string[] | undefined,
): boolean {
  const origin = request.headers.origin;
  if (origin === undefined) return true;
  if (allowedOrigins !== undefined) return allowedOrigins.includes(origin);
  try {
    return new URL(origin).host === request.headers.host;
  } catch {
    return false;
  }
}

/** Refuse an upgrade with a bare HTTP status. */
export function rejectUpgrade(socket: Duplex, status: number, message: string): void {
  if (socket.writable) {
    socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  }
  socket.destroy();
}

const pingIntervalMs = 30_000;

/** Ping a browser socket on a timer and drop it if it stops answering. Returns a stop function. */
export function keepAlive(ws: WebSocket): () => void {
  let alive = true;
  ws.on("pong", () => {
    alive = true;
  });
  const timer = setInterval(() => {
    if (!alive) {
      ws.terminate();
      return;
    }
    alive = false;
    ws.ping();
  }, pingIntervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

export function sendJson(ws: WebSocket, value: unknown): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(value));
}

/** Send bytes; settles when the socket accepted them, which is what drives flow control. */
export function sendBinary(ws: WebSocket, chunk: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.send(chunk, { binary: true }, (error) => (error ? reject(error) : resolve()));
  });
}

/** What the hub does with a browser's upgrade request, once it is allowed through. */
export interface BrowserRoute<Grant> {
  /** Undefined when the hub was not given an authorizer for this route: the answer is 404. */
  authorize:
    | ((request: IncomingMessage) => Promise<Grant | null | undefined> | Grant | null | undefined)
    | undefined;
  /** Refuse a grant that names no sandbox or an unusable target, as if it were not authorized. */
  valid: (grant: Grant) => boolean;
  allowedOrigins: readonly string[] | undefined;
  isClosed: () => boolean;
  server: WebSocketServer;
  /** The upgrade completed: hand the socket to its relay. */
  onSocket: (ws: WebSocket, grant: Grant) => void;
}

/**
 * The checks every browser relay shares: the hub is open (503), the route has an authorizer (404),
 * the Origin is acceptable (403), and the ticket was authorized (401). Origin is checked before the
 * authorizer runs, so a foreign page cannot even spend a ticket.
 */
export function handleBrowserUpgrade<Grant>(
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  route: BrowserRoute<Grant>,
): void {
  socket.on("error", () => undefined);
  if (route.isClosed()) return rejectUpgrade(socket, 503, "Service Unavailable");
  const { authorize } = route;
  if (authorize === undefined) return rejectUpgrade(socket, 404, "Not Found");
  if (!originAllowed(request, route.allowedOrigins)) return rejectUpgrade(socket, 403, "Forbidden");
  void (async () => {
    let grant: Grant | null | undefined;
    try {
      grant = await authorize(request);
    } catch {
      return rejectUpgrade(socket, 500, "Internal Server Error");
    }
    if (grant === null || grant === undefined || !route.valid(grant)) {
      return rejectUpgrade(socket, 401, "Unauthorized");
    }
    if (route.isClosed() || socket.destroyed) return socket.destroy();
    const granted = grant;
    route.server.handleUpgrade(request, socket, head, (ws) => route.onSocket(ws, granted));
  })();
}
