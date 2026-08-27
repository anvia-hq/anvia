import { defineEvalSuite, exactMatch, selectPromptOutput } from "@anvia/core/evals";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveLensConfig } from "../src/config";
import { createLensRedactor } from "../src/redaction";
import { LensClient } from "../src/tracing";

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
  it("accepts infrastructure reporters without application generic wrappers", () => {
    vi.stubEnv("ANVIA_LENS_BASE_URL", "");
    vi.stubEnv("ANVIA_LENS_PUBLIC_KEY", "");
    vi.stubEnv("ANVIA_LENS_SECRET_KEY", "");
    const client = new LensClient({ optional: true, serviceName: "typed-evals" });
    const reporter = client.evalReporter();
    const suite = defineEvalSuite({
      name: "typed lens",
      cases: [{ id: "case", input: "hello", expected: "hello" }],
      target: (input) => ({ output: input }),
      metrics: [exactMatch({ actual: selectPromptOutput })],
      reporters: [reporter],
    });

    expect(suite.reporters).toEqual([reporter]);
  });

  it("returns no-op tracing when optional environment configuration is absent", async () => {
    vi.stubEnv("ANVIA_LENS_BASE_URL", undefined);
    vi.stubEnv("ANVIA_LENS_PUBLIC_KEY", undefined);
    vi.stubEnv("ANVIA_LENS_SECRET_KEY", undefined);
    vi.stubEnv("ANVIA_LENS_SERVICE_NAME", undefined);

    const client = new LensClient({ optional: true, serviceName: "evals" });
    expect(client.enabled).toBe(false);
    expect(
      client.pipelineObserver().startRun({
        runId: "pipeline-run",
        pipelineId: "pipeline",
        input: "hello",
      }),
    ).toBeUndefined();
    await expect(client.flush()).resolves.toBeUndefined();
    await expect(client.close()).resolves.toBeUndefined();
    await expect(client.close()).resolves.toBeUndefined();
  });

  it("still rejects partially configured optional environments", () => {
    vi.stubEnv("ANVIA_LENS_BASE_URL", "https://lens.test");
    vi.stubEnv("ANVIA_LENS_PUBLIC_KEY", undefined);
    vi.stubEnv("ANVIA_LENS_SECRET_KEY", undefined);

    expect(() => new LensClient({ optional: true, serviceName: "evals" })).toThrow(
      /publicKey is required/,
    );
  });

  it("closes terminally without initializing unused infrastructure", async () => {
    const client = new LensClient({
      baseUrl: "https://lens.test",
      publicKey: "public",
      secretKey: "secret",
      serviceName: "test",
    });

    const observer = client.observer();
    const pipelineObserver = client.pipelineObserver();
    const reporter = client.evalReporter();
    const datasets = client.datasetClient();
    await client.close();
    await client.close();
    await client[Symbol.asyncDispose]();
    expect(() => client.observer()).toThrow("LensClient is closed");
    expect(() => client.pipelineObserver()).toThrow("LensClient is closed");
    await expect(
      observer.startRun({
        runId: "closed",
        prompt: { role: "user", content: "closed" },
        history: [],
        maxTurns: 1,
      }),
    ).rejects.toThrow("LensClient is closed");
    await expect(
      pipelineObserver.startRun({
        runId: "closed",
        pipelineId: "closed",
        input: "closed",
      }),
    ).rejects.toThrow("LensClient is closed");
    await expect(
      reporter.report({
        suiteName: "closed",
        case: { id: "closed", input: "closed" },
        metric: {
          name: "closed",
          evaluate: () => {
            throw new Error("unused");
          },
        },
        outcome: { outcome: "pass", score: true },
      }),
    ).rejects.toThrow("LensClient is closed");
    expect(() => datasets.getDataset({ name: "closed" })).toThrow("LensClient is closed");
  });

  it("keeps reporter completion separate from client flushing", async () => {
    vi.stubEnv("ANVIA_LENS_BASE_URL", undefined);
    vi.stubEnv("ANVIA_LENS_PUBLIC_KEY", undefined);
    vi.stubEnv("ANVIA_LENS_SECRET_KEY", undefined);
    const client = new LensClient({ optional: true, serviceName: "evals" });
    const flush = vi.spyOn(client, "flush");
    const reporter = client.evalReporter();

    await reporter.onRunEnd?.(runEndArgs());
    expect(flush).not.toHaveBeenCalled();
    await client[Symbol.asyncDispose]();
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
