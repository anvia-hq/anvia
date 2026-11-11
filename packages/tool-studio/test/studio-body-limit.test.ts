import { afterEach, describe, expect, it } from "vitest";
import { Studio } from "../src/index";

const studios: Studio[] = [];

afterEach(() => {
  while (studios.length > 0) {
    studios.pop()?.close();
  }
});

function track(studio: Studio): Studio {
  studios.push(studio);
  return studio;
}

function postSession(studio: Studio, body: string): Response | Promise<Response> {
  return studio.fetch(
    new Request("http://localhost:4021/sessions", {
      method: "POST",
      headers: { host: "localhost:4021", "content-type": "application/json" },
      body,
    }),
  );
}

describe("Studio request body limits", () => {
  it("rejects a JSON body above the configured limit", async () => {
    const studio = track(new Studio([], { ui: false, maxBodyBytes: 1024 }));

    const response = await postSession(studio, JSON.stringify({ message: "x".repeat(4096) }));

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ error: { code: "payload_too_large" } });
  });

  it("still handles a body below the configured limit", async () => {
    const studio = track(new Studio([], { ui: false, maxBodyBytes: 1024 }));

    const response = await postSession(studio, JSON.stringify({ message: "ok" }));

    expect(response.status).not.toBe(413);
  });

  it("applies the limit to in-process callers of the app directly", async () => {
    const studio = track(new Studio([], { ui: false, maxBodyBytes: 512 }));

    const response = await studio.app.request("http://localhost:4021/sessions", {
      method: "POST",
      headers: { host: "localhost:4021", "content-type": "application/json" },
      body: "x".repeat(2048),
    });

    expect(response.status).toBe(413);
  });

  it("rejects a non-positive limit at construction", () => {
    expect(() => new Studio([], { ui: false, maxBodyBytes: 0 })).toThrow(RangeError);
    expect(() => new Studio([], { ui: false, maxBodyBytes: 1.5 })).toThrow(RangeError);
  });
});
