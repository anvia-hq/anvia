import { describe, expect, it } from "vitest";
import { decodeTunnelBytes, encodeTunnelBytes } from "../src/remote/binary-frame";

const frame = (overrides: Partial<Parameters<typeof encodeTunnelBytes>[0]> = {}) => ({
  type: "tunnel.bytes" as const,
  tunnelId: "0b7e2d54-9c1f-4a52-8f55-3d3f6a2a1e10",
  seq: 7,
  bytes: Uint8Array.from([1, 2, 3, 250, 0, 255]),
  ...overrides,
});

describe("binary tunnel frames", () => {
  it("round-trips both directions, bytes and all", () => {
    for (const direction of ["toHub", "toDaemon"] as const) {
      const decoded = decodeTunnelBytes(encodeTunnelBytes(frame(), direction), direction);
      expect(decoded).toEqual(frame());
    }
  });

  it("carries an empty payload, a long id, and a multi-byte id", () => {
    const empty = frame({ bytes: new Uint8Array(0) });
    expect(decodeTunnelBytes(encodeTunnelBytes(empty, "toHub"), "toHub")).toEqual(empty);
    const long = frame({ tunnelId: "t".repeat(128) });
    expect(decodeTunnelBytes(encodeTunnelBytes(long, "toHub"), "toHub")).toEqual(long);
    const unicode = frame({ tunnelId: "túnel-é" });
    expect(decodeTunnelBytes(encodeTunnelBytes(unicode, "toHub"), "toHub")).toEqual(unicode);
  });

  it("wraps the sequence number at 32 bits on the wire", () => {
    const wrapped = decodeTunnelBytes(
      encodeTunnelBytes(frame({ seq: 2 ** 32 + 5 }), "toHub"),
      "toHub",
    );
    expect(wrapped.seq).toBe(5);
  });

  it("is a few dozen bytes of header, and the payload untouched after it", () => {
    const wire = encodeTunnelBytes(frame(), "toHub");
    expect(wire.byteLength).toBe(2 + 36 + 4 + 6);
    expect([...wire.subarray(wire.byteLength - 6)]).toEqual([1, 2, 3, 250, 0, 255]);
  });

  it("refuses a frame travelling the other way", () => {
    expect(() => decodeTunnelBytes(encodeTunnelBytes(frame(), "toHub"), "toDaemon")).toThrow(
      /unexpected kind/,
    );
    expect(() => decodeTunnelBytes(encodeTunnelBytes(frame(), "toDaemon"), "toHub")).toThrow(
      /unexpected kind/,
    );
  });

  it("refuses what is not a frame", () => {
    const good = encodeTunnelBytes(frame(), "toHub");
    expect(() => decodeTunnelBytes(new Uint8Array(0), "toHub")).toThrow(/too short/);
    expect(() => decodeTunnelBytes(Uint8Array.from([1]), "toHub")).toThrow(/too short/);
    expect(() => decodeTunnelBytes(Uint8Array.from([1, 0, 0, 0, 0, 0]), "toHub")).toThrow(
      /id length/,
    );
    // The header says an id of 36 bytes, and then stops short.
    expect(() => decodeTunnelBytes(good.subarray(0, 20), "toHub")).toThrow(/truncated/);
    expect(() => decodeTunnelBytes(Uint8Array.from([9, ...good.subarray(1)]), "toHub")).toThrow(
      /unexpected kind/,
    );
  });

  it("refuses a payload over a mebibyte, and an id that cannot be sent", () => {
    const huge = encodeTunnelBytes(frame({ bytes: new Uint8Array(1024 * 1024 + 1) }), "toHub");
    expect(() => decodeTunnelBytes(huge, "toHub")).toThrow(/too large/);
    expect(() => encodeTunnelBytes(frame({ tunnelId: "" }), "toHub")).toThrow(RangeError);
    expect(() => encodeTunnelBytes(frame({ tunnelId: "t".repeat(129) }), "toHub")).toThrow(
      RangeError,
    );
  });

  it("hands back bytes the caller owns, not a view of the socket's buffer", () => {
    const wire = encodeTunnelBytes(frame(), "toHub");
    const decoded = decodeTunnelBytes(wire, "toHub");
    wire.fill(0);
    expect([...decoded.bytes]).toEqual([1, 2, 3, 250, 0, 255]);
  });
});
