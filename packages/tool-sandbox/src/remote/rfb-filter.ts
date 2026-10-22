/** The browser sent something the filter cannot account for, so it cannot be relayed safely. */
export class RfbProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RfbProtocolError";
  }
}

type Stage = "version" | "security" | "init" | "messages";

const versionLength = 12;
/** Largest clipboard text or encoding list accepted, so a lying length cannot buffer without end. */
const maxVariableBytes = 1024 * 1024;
const maxEncodings = 4_096;
const noSecurity = 1;

/**
 * Sits on the browser-to-server half of an RFB (VNC) connection and removes the messages that would
 * let a viewer drive the desktop: key and pointer events, clipboard text, and the QEMU extended key
 * event. Everything else passes through untouched, so watching works as normal.
 *
 * It has to follow the stream's framing exactly, because dropping a message means knowing where it
 * ends. The handshake is passed through (only "no security" is accepted, which is all the desktop's
 * VNC server offers), then each client message is measured, judged, and forwarded or dropped.
 * Anything it does not recognise is an error: guessing at a length could let input through.
 *
 * `allowInput` is asked once per input message, so a viewer can lose or gain input mid-session, for
 * example when someone else takes control.
 */
export class RfbClientFilter {
  private stage: Stage = "version";
  private buffer: Uint8Array = new Uint8Array(0);
  private hasSecurityByte = true;

  constructor(private readonly allowInput: () => boolean) {}

  /** Feed bytes from the browser. Returns what to forward to the server, possibly nothing. */
  push(chunk: Uint8Array): Uint8Array {
    this.buffer = concat(this.buffer, chunk);
    const forward: Uint8Array[] = [];
    while (this.buffer.byteLength > 0) {
      const consumed = this.step(forward);
      if (consumed === 0) break;
      this.buffer = this.buffer.subarray(consumed);
    }
    return concat(...forward);
  }

  /** Handle one unit at the front of the buffer. Returns bytes consumed, 0 if more are needed. */
  private step(forward: Uint8Array[]): number {
    const { buffer } = this;
    switch (this.stage) {
      case "version": {
        if (buffer.byteLength < versionLength) return 0;
        const version = new TextDecoder("latin1").decode(buffer.subarray(0, versionLength));
        const match = /^RFB 003\.(\d{3})\n$/.exec(version);
        if (match === null) throw new RfbProtocolError("Not an RFB handshake.");
        // From 3.7 the client picks a security type; in 3.3 the server dictates it.
        this.hasSecurityByte = Number(match[1]) >= 7;
        this.stage = this.hasSecurityByte ? "security" : "init";
        forward.push(buffer.subarray(0, versionLength));
        return versionLength;
      }
      case "security":
        if (buffer[0] !== noSecurity) {
          throw new RfbProtocolError("Only RFB without authentication is supported.");
        }
        this.stage = "init";
        forward.push(buffer.subarray(0, 1));
        return 1;
      case "init":
        this.stage = "messages";
        forward.push(buffer.subarray(0, 1));
        return 1;
      case "messages":
        return this.message(forward);
    }
  }

  private message(forward: Uint8Array[]): number {
    const { buffer } = this;
    const type = buffer[0];
    let length: number | undefined;
    let kind: "pass" | "input" | "drop" = "pass";
    switch (type) {
      case 0: // SetPixelFormat
        length = 20;
        break;
      case 2: {
        // SetEncodings
        if (buffer.byteLength < 4) return 0;
        const count = (buffer[2] ?? 0) * 256 + (buffer[3] ?? 0);
        if (count > maxEncodings) throw new RfbProtocolError("Too many encodings.");
        length = 4 + 4 * count;
        break;
      }
      case 3: // FramebufferUpdateRequest
        length = 10;
        break;
      case 4: // KeyEvent
        length = 8;
        kind = "input";
        break;
      case 5: // PointerEvent
        length = 6;
        kind = "input";
        break;
      case 6: {
        // ClientCutText
        if (buffer.byteLength < 8) return 0;
        const text = readUint32(buffer, 4);
        if (text > maxVariableBytes) throw new RfbProtocolError("Clipboard text is too large.");
        length = 8 + text;
        kind = "input";
        break;
      }
      case 248: {
        // ClientFence
        if (buffer.byteLength < 9) return 0;
        length = 9 + (buffer[8] ?? 0);
        break;
      }
      case 250: // xvp
        length = 4;
        break;
      case 251: {
        // SetDesktopSize: the size is set through the API, never by a viewer.
        if (buffer.byteLength < 8) return 0;
        length = 8 + 16 * (buffer[6] ?? 0);
        kind = "drop";
        break;
      }
      case 255: {
        // QEMU extended messages: only the extended key event is known, and it is input.
        if (buffer.byteLength < 2) return 0;
        if (buffer[1] !== 0) throw new RfbProtocolError("Unsupported QEMU message.");
        length = 12;
        kind = "input";
        break;
      }
      default:
        throw new RfbProtocolError(`Unsupported RFB message type ${type}.`);
    }
    if (buffer.byteLength < length) return 0;
    if (kind === "pass" || (kind === "input" && this.allowInput())) {
      forward.push(buffer.subarray(0, length));
    }
    return length;
  }
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] ?? 0) * 0x1000000 +
    ((bytes[offset + 1] ?? 0) << 16) +
    ((bytes[offset + 2] ?? 0) << 8) +
    (bytes[offset + 3] ?? 0)
  );
}

function concat(...parts: Uint8Array[]): Uint8Array {
  if (parts.length === 1 && parts[0] !== undefined) return parts[0];
  const out = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}
