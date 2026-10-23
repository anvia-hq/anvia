import { describe, expect, it } from "vitest";
import { RfbClientFilter, RfbProtocolError } from "../src/remote/rfb-filter";

const bytes = (...values: number[]) => Uint8Array.from(values);
const join = (...parts: Uint8Array[]) => Uint8Array.from(parts.flatMap((part) => [...part]));
const ascii = (text: string) => new TextEncoder().encode(text);

const version = (minor: number) => ascii(`RFB 003.00${minor}\n`);
const handshake = (minor = 8) =>
  minor >= 7 ? join(version(minor), bytes(1), bytes(1)) : join(version(minor), bytes(1));
const setPixelFormat = join(bytes(0, 0, 0, 0), new Uint8Array(16));
const setEncodings = (count: number) => join(bytes(2, 0, 0, count), new Uint8Array(4 * count));
const updateRequest = bytes(3, 1, 0, 0, 0, 0, 3, 0, 2, 0);
const keyEvent = bytes(4, 1, 0, 0, 0, 0, 0, 0x61);
const pointerEvent = bytes(5, 1, 0, 10, 0, 20);
const cutText = (text: string) => join(bytes(6, 0, 0, 0, 0, 0, 0, text.length), ascii(text));
// Extended Clipboard: the length is negative, and its absolute value is the payload size.
const extendedCutText = (payload: number) =>
  join(
    bytes(6, 0, 0, 0),
    bytes(...Array.from({ length: 4 }, (_, i) => (-payload >> (24 - 8 * i)) & 0xff)),
    new Uint8Array(payload),
  );
const qemuKey = join(bytes(255, 0, 0, 1), new Uint8Array(8));
const setDesktopSize = join(bytes(251, 0, 5, 0, 3, 0, 1, 0), new Uint8Array(16));

function run(allow: boolean | (() => boolean), ...chunks: Uint8Array[]) {
  const filter = new RfbClientFilter(typeof allow === "function" ? allow : () => allow);
  return join(...chunks.map((chunk) => filter.push(chunk)));
}

const session = join(
  handshake(),
  setPixelFormat,
  setEncodings(3),
  updateRequest,
  keyEvent,
  pointerEvent,
  cutText("hi"),
  updateRequest,
);

describe("RfbClientFilter", () => {
  it("passes everything for a viewer that may type", () => {
    expect(run(true, session)).toEqual(session);
  });

  it("removes key, pointer and clipboard input but keeps the rest for a read-only viewer", () => {
    const watching = join(
      handshake(),
      setPixelFormat,
      setEncodings(3),
      updateRequest,
      updateRequest,
    );
    expect(run(false, session)).toEqual(watching);
  });

  it("measures an Extended Clipboard message, whose length is negative, and treats it as input", () => {
    // This is what noVNC sends as soon as the server advertises the extension. Reading the length
    // as unsigned made it look like a four-gigabyte clipboard and ended the session.
    const clipboard = extendedCutText(8);
    expect(clipboard.byteLength).toBe(16);
    const stream = join(handshake(), clipboard, updateRequest);
    expect(run(true, stream)).toEqual(stream);
    expect(run(false, stream)).toEqual(join(handshake(), updateRequest));

    for (const size of [1, 3, 7]) {
      const chunks: Uint8Array[] = [];
      for (let offset = 0; offset < stream.byteLength; offset += size) {
        chunks.push(stream.subarray(offset, offset + size));
      }
      expect(run(false, ...chunks)).toEqual(join(handshake(), updateRequest));
    }
  });

  it("removes the QEMU extended key event and any resize request", () => {
    const input = join(handshake(), qemuKey, setDesktopSize, updateRequest);
    expect(run(true, input)).toEqual(join(handshake(), qemuKey, updateRequest));
    expect(run(false, input)).toEqual(join(handshake(), updateRequest));
  });

  it("gives the same answer however the stream is cut into chunks", () => {
    const expected = run(false, session);
    for (const size of [1, 2, 3, 5, 7, 11, 64]) {
      const chunks: Uint8Array[] = [];
      for (let offset = 0; offset < session.byteLength; offset += size) {
        chunks.push(session.subarray(offset, offset + size));
      }
      expect(run(false, ...chunks)).toEqual(expected);
    }
  });

  it("asks for each input message separately, so a viewer can gain or lose input mid-stream", () => {
    let allowed = true;
    const filter = new RfbClientFilter(() => allowed);
    filter.push(handshake());
    expect(filter.push(pointerEvent)).toEqual(pointerEvent);
    allowed = false;
    expect(filter.push(join(pointerEvent, keyEvent))).toEqual(bytes());
    allowed = true;
    expect(filter.push(keyEvent)).toEqual(keyEvent);
  });

  it("holds back a message until it is complete", () => {
    const filter = new RfbClientFilter(() => true);
    filter.push(handshake());
    expect(filter.push(pointerEvent.subarray(0, 3))).toEqual(bytes());
    expect(filter.push(pointerEvent.subarray(3))).toEqual(pointerEvent);
  });

  it("follows the 3.3 handshake, which has no security byte", () => {
    const input = join(handshake(3), keyEvent, updateRequest);
    expect(run(false, input)).toEqual(join(handshake(3), updateRequest));
  });

  it("fails closed on anything it cannot measure", () => {
    expect(() => run(true, handshake(), bytes(99))).toThrow(RfbProtocolError);
    expect(() => run(true, ascii("GET / HTTP/1.1\r\n\r\n"))).toThrow(RfbProtocolError);
    expect(() => run(true, join(version(8), bytes(2)))).toThrow(/without authentication/);
    expect(() => run(true, handshake(), bytes(255, 7))).toThrow(RfbProtocolError);
  });

  it("refuses lengths that would make it buffer without end", () => {
    expect(() => run(true, handshake(), bytes(2, 0, 0xff, 0xff))).toThrow(/encodings/);
    expect(() => run(true, handshake(), bytes(6, 0, 0, 0, 0x7f, 0xff, 0xff, 0xff))).toThrow(
      /too large/,
    );
    // A huge negative length is just as large a payload.
    expect(() => run(true, handshake(), bytes(6, 0, 0, 0, 0x80, 0, 0, 1))).toThrow(/too large/);
  });
});
