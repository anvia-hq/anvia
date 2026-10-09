import { StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

/** Own session cleanup here because the SDK also closes on handshake failure. */
export class ManagedMcpHttpTransport extends StreamableHTTPClientTransport {
  readonly #terminate: boolean;
  #closing?: Promise<void>;

  constructor(
    url: URL,
    options: ConstructorParameters<typeof StreamableHTTPClientTransport>[1],
    terminate: boolean,
  ) {
    super(url, options);
    this.#terminate = terminate;
  }

  override close(): Promise<void> {
    this.#closing ??= this.#close();
    return this.#closing;
  }

  async #close(): Promise<void> {
    try {
      if (this.#terminate && this.sessionId) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          // Race explicitly: even a stalled auth provider must not prevent close.
          // super.close below aborts the pending HTTP request after the deadline.
          await Promise.race([
            this.terminateSession().catch(() => {}),
            new Promise<void>((resolve) => {
              timer = setTimeout(resolve, 2000);
            }),
          ]);
        } finally {
          clearTimeout(timer);
        }
      }
    } finally {
      await super.close();
    }
  }
}
