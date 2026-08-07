import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveLensConfig } from "../src/config";
import { createLensRedactor } from "../src/redaction";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveLensConfig", () => {
  it("resolves explicit options before environment values", () => {
    vi.stubEnv("ANVIA_LENS_BASE_URL", "https://env.lens.test/");
    vi.stubEnv("ANVIA_LENS_PUBLIC_KEY", "env-public");
    vi.stubEnv("ANVIA_LENS_SECRET_KEY", "env-secret");
    vi.stubEnv("ANVIA_LENS_SERVICE_NAME", "env-service");
    vi.stubEnv("NODE_ENV", "test");

    expect(
      resolveLensConfig({
        baseUrl: "https://option.lens.test/",
        publicKey: "option-public",
        secretKey: "option-secret",
        serviceName: "option-service",
        environment: "staging",
        release: "release-1",
      }),
    ).toMatchObject({
      baseUrl: "https://option.lens.test",
      publicKey: "option-public",
      secretKey: "option-secret",
      serviceName: "option-service",
      environment: "staging",
      release: "release-1",
      captureMode: "safe",
      captureMaxBytes: 262_144,
    });
  });

  it("requires endpoint credentials and service name", () => {
    expect(() => resolveLensConfig()).toThrow(/baseUrl is required/);
    vi.stubEnv("ANVIA_LENS_BASE_URL", "http://localhost");
    expect(() => resolveLensConfig()).toThrow(/publicKey is required/);
  });
});

describe("createLensRedactor", () => {
  it("redacts nested values without mutating the source", () => {
    const source = { email: "person@example.com", nested: ["Bearer secret-token"] };
    const result = createLensRedactor().redact(source);

    expect(result).toEqual({ email: "<redacted>", nested: ["<redacted>"] });
    expect(source.email).toBe("person@example.com");
  });
});
