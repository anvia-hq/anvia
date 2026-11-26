import { randomBytes } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import WebSocket, { type WebSocketServer } from "ws";

const ticketPrefix = "anvia.ticket.";
const defaultTicketTtlMs = 30_000;
const defaultMaxTicketEntries = 10_000;

export interface RelayTicketStoreOptions {
  /** How long a minted ticket stays valid before expiring. Default 30s. */
  ttlMs?: number;
  /** Maximum unredeemed tickets kept in memory at once. Default 10,000. */
  maxEntries?: number;
  /** Clock source, mostly for tests. Default `Date.now`. */
  now?: () => number;
}

/** In-memory store for single-use, expiring browser relay tickets. */
export interface RelayTicketStore<Grant> {
  /** Create a URL-safe single-use ticket bound to `grant`. */
  mint(grant: Grant, options?: { ttlMs?: number }): string;
  /** Consume a ticket once, returning its grant or `null` if unknown or expired. */
  redeem(ticket: string | undefined): Grant | null;
  /** Read a ticket from an upgrade request (`relayTicket`) and consume it once. */
  redeemRequest(request: IncomingMessage): Grant | null;
  /** Revoke an unredeemed ticket. Returns true if it was present. */
  revoke(ticket: string): boolean;
  /** Drop every unredeemed ticket. */
  clear(): void;
  /** Number of currently valid unredeemed tickets. */
  readonly size: number;
}

/**
 * Create an in-memory store for short-lived, single-use tickets used with `authorizeTerminal`,
 * `authorizeTunnel`, and `authorizeDesktop`. Expired entries are pruned automatically on use.
 */
export function createRelayTicketStore<Grant>(
  options: RelayTicketStoreOptions = {},
): RelayTicketStore<Grant> {
  const defaultTtlMs = options.ttlMs ?? defaultTicketTtlMs;
  const maxEntries = options.maxEntries ?? defaultMaxTicketEntries;
  const now = options.now ?? Date.now;

  if (!Number.isSafeInteger(defaultTtlMs) || defaultTtlMs <= 0) {
    throw new RangeError("ttlMs must be a positive safe integer.");
  }

  if (!Number.isSafeInteger(maxEntries) || maxEntries <= 0) {
    throw new RangeError("maxEntries must be a positive safe integer.");
  }

  const entries = new Map<string, { grant: Grant; expiresAt: number }>();

  const prune = (currentTime: number) => {
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= currentTime) entries.delete(key);
    }
  };

  const redeem = (ticket: string | undefined): Grant | null => {
    if (ticket === undefined || ticket.length === 0) return null;

    const entry = entries.get(ticket);

    if (entry === undefined) return null;

    entries.delete(ticket);
    return entry.expiresAt > now() ? entry.grant : null;
  };

  return {
    mint(grant, mintOptions) {
      const ttlMs = mintOptions?.ttlMs ?? defaultTtlMs;

      if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) {
        throw new RangeError("ttlMs must be a positive safe integer.");
      }

      const currentTime = now();
      prune(currentTime);

      while (entries.size >= maxEntries) {
        const oldest = entries.keys().next().value;

        if (oldest === undefined) break;

        entries.delete(oldest);
      }

      const ticket = randomBytes(24).toString("base64url");
      entries.set(ticket, { grant, expiresAt: currentTime + ttlMs });
      return ticket;
    },
    redeem,
    redeemRequest(request) {
      return redeem(relayTicket(request));
    },
    revoke(ticket) {
      return entries.delete(ticket);
    },
    clear() {
      entries.clear();
    },
    get size() {
      prune(now());
      return entries.size;
    },
  };
}

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
  /** Called if `authorize` throws instead of returning null/undefined. */
  onError?: ((error: unknown) => void) | undefined;
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
    } catch (error) {
      route.onError?.(error);
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
