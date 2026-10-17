import { afterEach, describe, expect, it } from "vitest";
import { convertPrompt, type PromptBlock } from "../src/content.js";
import { resolveLimits } from "../src/limits.js";
import type { AcpConnection, AcpLimits } from "../src/types.js";
import { makeAgent, wireFixture } from "./helpers.js";

const limits = resolveLimits();
const image: PromptBlock = { type: "image", data: "AQID", mimeType: "image/png" };
const cleanup: AcpConnection[] = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((connection) => connection.close()));
});

describe("prompt content policy", () => {
  it("preserves text, image payload, MIME type and block order as a user message", () => {
    expect(
      convertPrompt(
        [{ type: "text", text: "猫🙂" }, image, { type: "text", text: "after" }],
        limits,
        true,
      ),
    ).toEqual({
      role: "user",
      content: [
        { type: "text", text: "猫🙂" },
        { type: "image", image: { type: "data", data: "AQID" }, mediaType: "image/png" },
        { type: "text", text: "after" },
      ],
    });
  });

  it("keeps resource links as labelled references without fetching them", () => {
    const result = convertPrompt(
      [
        {
          type: "resource_link",
          uri: "file:///not-readable",
          name: "file",
          description: "untrusted context",
        },
      ],
      limits,
      false,
    );
    expect(result.content).toEqual([
      {
        type: "text",
        text: 'Resource reference: {"name":"file","uri":"file:///not-readable","description":"untrusted context"}',
      },
    ]);
  });

  it("rejects empty prompts, disabled images and unsupported content", () => {
    expect(() => convertPrompt([], limits, true)).toThrow("invalid_content");
    expect(() => convertPrompt([image], limits, false)).toThrow("unsupported_content");
    expect(() => convertPrompt([{ type: "unsupported" }], limits, true)).toThrow(
      "unsupported_content",
    );
  });

  it.each(["", "data:image/png;base64,AQID", "AQ I", "AA=", "====", "AB==", "AA==junk"])(
    "rejects malformed/noncanonical base64 %j",
    (data) => {
      expect(() =>
        convertPrompt([{ type: "image", data, mimeType: "image/png" }], limits, true),
      ).toThrow("invalid_content");
    },
  );

  it.each(["text/plain", "image/svg+xml", "image/png; charset=utf-8"])(
    "rejects unsupported image MIME %s",
    (mimeType) => {
      expect(() =>
        convertPrompt([{ type: "image", data: "AQID", mimeType }], limits, true),
      ).toThrow("unsupported_content");
    },
  );

  it("counts UTF-8 bytes across text and resource links, not characters", () => {
    const bounded = resolveLimits({ maxTextBytes: 4 });
    expect(() => convertPrompt([{ type: "text", text: "🙂" }], bounded, false)).not.toThrow();
    expect(() =>
      convertPrompt(
        [
          { type: "text", text: "🙂" },
          { type: "text", text: "a" },
        ],
        bounded,
        false,
      ),
    ).toThrow("resource_limit");
    expect(() =>
      convertPrompt([{ type: "resource_link", uri: "file:///a", name: "a" }], bounded, false),
    ).toThrow("resource_limit");
  });

  it("bounds decoded image size, aggregate encoded bytes and block counts", () => {
    expect(() => convertPrompt([image], resolveLimits({ maxImageBytes: 3 }), true)).not.toThrow();
    expect(() => convertPrompt([image], resolveLimits({ maxImageBytes: 2 }), true)).toThrow(
      "resource_limit",
    );
    expect(() => convertPrompt([image, image], resolveLimits({ maxPromptBytes: 7 }), true)).toThrow(
      "resource_limit",
    );
    expect(() =>
      convertPrompt(
        [
          { type: "text", text: "" },
          { type: "text", text: "" },
        ],
        resolveLimits({ maxContentBlocks: 1 }),
        true,
      ),
    ).toThrow("resource_limit");
  });

  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid limit %s",
    (value) => {
      for (const key of Object.keys(limits) as Array<keyof AcpLimits>) {
        expect(() => resolveLimits({ [key]: value })).toThrow("positive safe integers");
      }
    },
  );

  it("converts image input end to end only after host opt-in and drops annotations", async () => {
    const model = makeAgent();
    const fixture = wireFixture({ sessionFactory: () => model, images: true });
    cleanup.push(fixture.connection);
    const init = await fixture.request("initialize", { protocolVersion: 1 });
    expect(init.result?.agentCapabilities).toMatchObject({ promptCapabilities: { image: true } });
    const sessionId = (await fixture.request("session/new", { cwd: process.cwd(), mcpServers: [] }))
      .result!.sessionId!;
    const response = await fixture.request("session/prompt", {
      sessionId,
      prompt: [
        { type: "text", text: "describe" },
        {
          ...image,
          uri: "https://unused.invalid",
          annotations: { audience: ["assistant"] },
          _meta: { secret: "not-model-input" },
        },
      ],
    });
    expect(response.result?.stopReason).toBe("end_turn");
    expect(model.requests[0]!.chatHistory[0]!.content).toEqual([
      { type: "text", text: "describe" },
      { type: "image", image: { type: "data", data: "AQID" }, mediaType: "image/png" },
    ]);
    expect(JSON.stringify(model.requests)).not.toMatch(
      /unused.invalid|not-model-input|annotations/,
    );
  });

  it("rejects unsupported and oversized wire content without running the model, then accepts valid input", async () => {
    const model = makeAgent();
    const fixture = wireFixture({ sessionFactory: () => model, limits: { maxTextBytes: 4 } });
    cleanup.push(fixture.connection);
    await fixture.request("initialize", { protocolVersion: 1 });
    const sessionId = (await fixture.request("session/new", { cwd: process.cwd(), mcpServers: [] }))
      .result!.sessionId!;
    for (const block of [
      image,
      { type: "audio", data: "AQID", mimeType: "audio/wav" },
      { type: "resource", resource: { uri: "file:///a", text: "context" } },
    ]) {
      const response = await fixture.request("session/prompt", { sessionId, prompt: [block] });
      expect(response.error).toMatchObject({ code: -32602, data: { kind: "unsupported_content" } });
    }
    const oversized = await fixture.request("session/prompt", {
      sessionId,
      prompt: [{ type: "text", text: "🙂a" }],
    });
    expect(oversized.error?.data?.kind).toBe("resource_limit");
    expect(model.requests).toHaveLength(0);
    expect(
      (
        await fixture.request("session/prompt", {
          sessionId,
          prompt: [{ type: "text", text: "ok" }],
        })
      ).result?.stopReason,
    ).toBe("end_turn");
  });

  it("rejects image-incapable factory bindings before accepting a session", async () => {
    const binding = makeAgent();
    binding.model.capabilities.imageInput = false;
    const fixture = wireFixture({ sessionFactory: () => binding, images: true });
    cleanup.push(fixture.connection);
    await fixture.request("initialize", { protocolVersion: 1 });
    expect(
      (await fixture.request("session/new", { cwd: process.cwd(), mcpServers: [] })).error?.data
        ?.kind,
    ).toBe("configuration_error");
  });
});
