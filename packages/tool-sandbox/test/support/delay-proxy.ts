import net from "node:net";

/**
 * A TCP proxy that holds every chunk for a while before passing it on, in both directions: a link
 * with a round-trip time. It works on any protocol riding TCP, a WebSocket handshake included.
 */
export class DelayProxy {
  /** One-way delay in ms, read for every chunk, so it can change under open connections. */
  oneWayMs = 0;
  private readonly sockets = new Set<net.Socket>();
  private readonly server = net.createServer((client) => {
    const upstream = net.connect({ host: "127.0.0.1", port: this.target });
    this.sockets.add(client).add(upstream);
    const forward = (from: net.Socket, to: net.Socket) => {
      from.on("data", (chunk) => {
        // Equal delays keep timers in order, so bytes stay in order.
        if (this.oneWayMs === 0) to.write(chunk);
        else setTimeout(() => to.writable && to.write(chunk), this.oneWayMs);
      });
      from.on("close", () => setTimeout(() => to.destroy(), this.oneWayMs));
      from.on("error", () => to.destroy());
    };
    forward(client, upstream);
    forward(upstream, client);
  });

  constructor(private readonly target: number) {}

  listen(host = "127.0.0.1"): Promise<number> {
    return new Promise((resolve) => {
      this.server.listen(0, host, () => resolve((this.server.address() as net.AddressInfo).port));
    });
  }

  close(): void {
    this.server.close();
    for (const socket of this.sockets) socket.destroy();
  }
}
