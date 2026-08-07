import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveLensConfig } from "../src/config";
import { createLensRedactor } from "../src/redaction";
import { createLensEvalReporter, lens } from "../src/tracing";

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

  it("rejects unsupported capture modes at runtime", () => {
    expect(() =>
      resolveLensConfig({
        baseUrl: "http://localhost",
        publicKey: "public",
        secretKey: "secret",
        serviceName: "test",
        captureMode: "unsafe" as never,
      }),
    ).toThrow(/captureMode must be "safe" or "full"/);
  });
});

describe("createLensRedactor", () => {
  it("redacts nested values without mutating the source", () => {
    const source = { email: "person@example.com", nested: ["Bearer secret-token"] };
    const result = createLensRedactor().redact(source);

    expect(result).toEqual({ email: "<redacted>", nested: ["<redacted>"] });
    expect(source.email).toBe("person@example.com");
  });

  it("redacts shared objects normally while preserving circular-reference markers", () => {
    const shared = { email: "person@example.com" };
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(createLensRedactor().redact({ first: shared, second: shared, circular })).toEqual({
      first: { email: "<redacted>" },
      second: { email: "<redacted>" },
      circular: { self: "<circular>" },
    });
  });
});

describe("Lens eval ergonomics", () => {
  it("returns no-op tracing when optional environment configuration is absent", async () => {
    vi.stubEnv("ANVIA_LENS_BASE_URL", undefined);
    vi.stubEnv("ANVIA_LENS_PUBLIC_KEY", undefined);
    vi.stubEnv("ANVIA_LENS_SECRET_KEY", undefined);
    vi.stubEnv("ANVIA_LENS_SERVICE_NAME", undefined);

    const tracing = lens.createFromEnv({ optional: true, serviceName: "evals" });
    expect(tracing.enabled).toBe(false);
    await expect(tracing.flush()).resolves.toBeUndefined();
    await expect(tracing.shutdown()).resolves.toBeUndefined();
  });

  it("still rejects partially configured optional environments", () => {
    vi.stubEnv("ANVIA_LENS_BASE_URL", "https://lens.test");
    vi.stubEnv("ANVIA_LENS_PUBLIC_KEY", undefined);
    vi.stubEnv("ANVIA_LENS_SECRET_KEY", undefined);

    expect(() => lens.createFromEnv({ optional: true, serviceName: "evals" })).toThrow(
      /publicKey is required/,
    );
  });

  it("flushes no-op reporters on run end and enables auto-flush in the bundle", async () => {
    vi.stubEnv("ANVIA_LENS_BASE_URL", undefined);
    vi.stubEnv("ANVIA_LENS_PUBLIC_KEY", undefined);
    vi.stubEnv("ANVIA_LENS_SECRET_KEY", undefined);
    const tracing = lens.createFromEnv({ optional: true, serviceName: "evals" });
    const flush = vi.spyOn(tracing, "flush");
    const reporter = createLensEvalReporter(tracing, { flushOnRunEnd: true });

    await reporter.onRunEnd?.(runEndArgs());
    expect(flush).toHaveBeenCalledOnce();

    const integration = lens.evals({ optional: true, serviceName: "evals" });
    const integrationFlush = vi.spyOn(integration.observer, "flush");
    await integration.reporter.onRunEnd?.(runEndArgs());
    expect(integration.enabled).toBe(false);
    expect(integrationFlush).toHaveBeenCalledOnce();
  });
});

function runEndArgs() {
  return {
    run: { id: "run-1", startedAt: "2026-08-07T00:00:00.000Z" },
    suiteName: "suite",
    caseCount: 1,
    metricNames: ["quality"],
    status: "completed" as const,
    completedAt: "2026-08-07T00:00:01.000Z",
    durationMs: 1_000,
  };
}
