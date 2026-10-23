import { DockerSandboxError } from "../errors";
import type { DaemonFrame } from "./protocol";

/**
 * Tunnel bytes as a binary WebSocket message, once both peers have said they can: no base64, no
 * JSON, and so no copy through a string. Everything else, the acknowledgements included, stays JSON.
 *
 * ```
 * [kind: 1][idLength: 1][tunnelId: idLength bytes of UTF-8][seq: uint32, big-endian][payload]
 * ```
 *
 * `kind` says which way the bytes travel, so a frame can never be taken for the other direction's.
 * `seq` counts frames per tunnel from zero and wraps at 2^32, which no tunnel lives to see.
 */
export const binaryDataCapability = "binary-data";

const kindToHub = 1;
const kindToDaemon = 2;
const maxIdBytes = 128;
const maxPayloadBytes = 1024 * 1024;

/** Bytes of a tunnel, in either direction, before they are put on the wire in one form or the other. */
export interface TunnelBytesFrame {
  type: "tunnel.bytes";
  tunnelId: string;
  seq: number;
  bytes: Uint8Array;
}

/** What the daemon puts on its link: a JSON frame, or tunnel bytes in whichever form was agreed. */
export type DaemonOutbound = DaemonFrame | TunnelBytesFrame;

export type BinaryDirection = "toHub" | "toDaemon";

export function encodeTunnelBytes(frame: TunnelBytesFrame, direction: BinaryDirection): Buffer {
  const id = Buffer.from(frame.tunnelId, "utf8");
  if (id.byteLength === 0 || id.byteLength > maxIdBytes) {
    throw new RangeError("A tunnel id is 1 to 128 bytes.");
  }
  const header = Buffer.allocUnsafe(2 + id.byteLength + 4);
  header[0] = direction === "toHub" ? kindToHub : kindToDaemon;
  header[1] = id.byteLength;
  id.copy(header, 2);
  header.writeUInt32BE(frame.seq >>> 0, 2 + id.byteLength);
  return Buffer.concat([header, frame.bytes], header.byteLength + frame.bytes.byteLength);
}

/** Read a binary message that travels `direction`. Anything else is a protocol error. */
export function decodeTunnelBytes(data: Uint8Array, direction: BinaryDirection): TunnelBytesFrame {
  const bad = (why: string) =>
    new DockerSandboxError(`Malformed binary frame: ${why}.`, "protocol");
  if (data.byteLength < 2) throw bad("too short");
  const kind = data[0];
  if (kind !== (direction === "toHub" ? kindToHub : kindToDaemon)) throw bad("unexpected kind");
  const idLength = data[1] ?? 0;
  if (idLength === 0 || idLength > maxIdBytes) throw bad("bad tunnel id length");
  const payloadAt = 2 + idLength + 4;
  if (data.byteLength < payloadAt) throw bad("truncated header");
  if (data.byteLength - payloadAt > maxPayloadBytes) throw bad("payload too large");
  const view = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  return {
    type: "tunnel.bytes",
    tunnelId: view.toString("utf8", 2, 2 + idLength),
    seq: view.readUInt32BE(2 + idLength),
    // A copy: the message buffer is the socket's to reuse.
    bytes: new Uint8Array(view.subarray(payloadAt)),
  };
}
