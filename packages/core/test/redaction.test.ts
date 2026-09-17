import { describe, expect, it } from "vitest";
import { createRedactor, DEFAULT_PATTERNS, passesLuhn } from "../src/redaction";

describe("createRedactor", () => {
  it("redacts nested values without mutating the source", () => {
    const source = { email: "person@example.com", nested: ["Bearer secret-token"] };
    const result = createRedactor().redact(source);

    expect(result).toEqual({ email: "<redacted>", nested: ["<redacted>"] });
    expect(source.email).toBe("person@example.com");
  });

  it("redacts shared objects normally while preserving circular-reference markers", () => {
    const shared = { email: "person@example.com" };
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(createRedactor().redact({ first: shared, second: shared, circular })).toEqual({
      first: { email: "<redacted>" },
      second: { email: "<redacted>" },
      circular: { self: "<circular>" },
    });
  });

  it("requires an issuer prefix and a Luhn checksum for card matches", () => {
    expect(passesLuhn("4111111111111111")).toBe(true);
    expect(passesLuhn("4111111111111112")).toBe(false);
    expect(
      createRedactor().redact({
        card: "card 4111-1111-1111-1111 today",
        invalid: "4111111111111112",
        order: "1234 5678 9012 3456",
      }),
    ).toEqual({
      card: "card <redacted> today",
      invalid: "4111111111111112",
      order: "1234 5678 9012 3456",
    });
  });

  it("redacts numeric card values and keeps unrelated numbers typed", () => {
    expect(
      createRedactor().redact({
        card: 4111111111111111,
        epochSeconds: 1_700_000_000,
        tokens: 1_234,
        ratio: 1.5,
      }),
    ).toEqual({
      card: "<redacted>",
      epochSeconds: 1_700_000_000,
      tokens: 1_234,
      ratio: 1.5,
    });
  });

  it("bounds deep payloads instead of walking arbitrary values", () => {
    const deep: Record<string, unknown> = { email: "person@example.com" };
    let cursor = deep;
    for (let depth = 0; depth < 20; depth += 1) {
      const next: Record<string, unknown> = { email: "person@example.com" };
      cursor.nested = next;
      cursor = next;
    }

    const serialized = JSON.stringify(createRedactor().redact({ deep }));
    expect(serialized).toContain("<max-depth>");
    expect(serialized).not.toContain("person@example.com");
  });

  it("keeps encoded payloads and binary values intact", () => {
    const binary = new Uint8Array([1, 2, 3]);

    expect(
      createRedactor().redact([
        { type: "image", data: "alice@example.com" },
        { type: "image", data: { email: "alice@example.com" } },
        { url: "data:image/png;base64,alice@example.com" },
        binary,
      ]),
    ).toEqual([
      { type: "image", data: "alice@example.com" },
      { type: "image", data: { email: "<redacted>" } },
      { url: "data:image/png;base64,alice@example.com" },
      binary,
    ]);
  });

  it("redacts phone numbers in common shapes and ignores grouped digit runs", () => {
    const redactor = createRedactor();

    expect(redactor.redactString("Call (415) 555-1212 or +1 415-555-1313 today")).toBe(
      "Call <redacted> or <redacted> today",
    );
    expect(redactor.redactString("from alice@example.com at 415-555-1212")).toBe(
      "from <redacted> at <redacted>",
    );
    expect(redactor.redactString("order 1234 5678 9012 3456 shipped")).toBe(
      "order 1234 5678 9012 3456 shipped",
    );
  });

  it("redacts tokens, addresses, and Bearer credentials in one string", () => {
    expect(
      createRedactor().redact({
        jwt: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature",
        key: "use sk-abcdefghijklmnopqrstuv to authenticate",
        bearer: "Authorization: Bearer secret-token",
        ip: "203.0.113.7",
      }),
    ).toEqual({
      jwt: "<redacted>",
      key: "use <redacted> to authenticate",
      bearer: "Authorization: <redacted>",
      ip: "<redacted>",
    });
  });

  it("uses the configured replacement and lets custom patterns replace the defaults", () => {
    const custom = createRedactor({
      patterns: [{ name: "ssn", regex: /\b\d{3}-\d{2}-\d{4}\b/g }],
      replacement: "[HIDDEN]",
    });

    expect(custom.patternNames()).toEqual(["ssn"]);
    expect(custom.redactString("ssn 123-45-6789 not alice@example.com")).toBe(
      "ssn [HIDDEN] not alice@example.com",
    );
    expect(createRedactor().patternNames()).toEqual(
      DEFAULT_PATTERNS.map((pattern) => pattern.name),
    );
  });

  it("supports custom patterns with named capture groups", () => {
    const seen: Array<{ match: string; offset: number; input: string }> = [];
    const redactor = createRedactor({
      patterns: [
        {
          name: "tag",
          regex: /\btag=(?<value>[a-z0-9]+)\b/g,
          validate: (match, offset, input) => {
            seen.push({ match, offset, input });
            return true;
          },
        },
      ],
    });

    expect(redactor.redactString("prefix tag=abc suffix")).toBe("prefix <redacted> suffix");
    expect(seen).toEqual([{ match: "tag=abc", offset: 7, input: "prefix tag=abc suffix" }]);
  });

  it("redacts message content, including tool-call inputs", () => {
    const redactor = createRedactor();
    const messages = redactor.redactMessages([
      { role: "user", content: [{ type: "text", text: "hi alice@example.com" }] },
      {
        role: "assistant",
        content: [
          { type: "text", text: "use 10.0.0.1" },
          {
            type: "tool-call",
            toolCallId: "c",
            toolName: "x",
            input: { note: "alice@example.com" },
          },
        ],
      },
    ]);

    expect(messages[0]?.content).toEqual([{ type: "text", text: "hi <redacted>" }]);
    expect(messages[1]?.content).toMatchObject([
      { type: "text", text: "use <redacted>" },
      { type: "tool-call", input: { note: "<redacted>" } },
    ]);
  });

  it("returns primitives unchanged", () => {
    const redactor = createRedactor();

    expect(redactor.redactObject(42)).toBe(42);
    expect(redactor.redactObject(null)).toBe(null);
    expect(redactor.redactObject(true)).toBe(true);
  });
});
