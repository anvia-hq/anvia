import { Usage, type Message } from "@anvia/core/completion";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionConfiguration } from "../src/config.js";
import { AcpError, errorCodes } from "../src/errors.js";
import { resolveLimits } from "../src/limits.js";
import { SessionMemory } from "../src/memory.js";
import { TurnBudget, TurnBudgetExceeded, validateTurnBudget } from "../src/turn-budget.js";
import type { AcpOptions, AcpTurnBudget } from "../src/types.js";
import { makeAgent } from "./helpers.js";

afterEach(() => vi.restoreAllMocks());
const scope = { sessionId: "owned" };
const message = (text: string): Message => ({ role: "user", content: [{ type: "text", text }] });

describe("private session memory", () => {
  it("snapshots both append inputs and loaded messages and rejects foreign scopes on every operation", async () => {
    const memory = new SessionMemory(scope.sessionId, resolveLimits());
    const messages = [message("original")];
    await memory.append({ scope, runId: "run", turn: 0, messages });
    Object.assign(messages[0]!.content[0]!, { text: "mutated input" });
    const loaded = await memory.load({ scope });
    Object.assign(loaded[0]!.content[0]!, { text: "mutated output" });
    expect(await memory.load({ scope })).toEqual([message("original")]);
    const foreign = { sessionId: "foreign" };
    for (const operation of [
      memory.load({ scope: foreign }),
      memory.clear({ scope: foreign }),
      memory.append({ scope: foreign, runId: "run", turn: 1, messages: [] }),
    ])
      await expect(operation).rejects.toMatchObject({ kind: "session_not_found" });
    expect(await memory.load({ scope })).toEqual([message("original")]);
    await memory.clear({ scope });
    expect(await memory.load({ scope })).toEqual([]);
  });

  it.each(["messages", "bytes"])(
    "rejects an entire append at the %s bound without corrupting prior history",
    async (bound) => {
      const first = message("é");
      const limits = resolveLimits(
        bound === "messages"
          ? { maxHistoryMessages: 1 }
          : { maxHistoryBytes: Buffer.byteLength(JSON.stringify([first])) },
      );
      const memory = new SessionMemory(scope.sessionId, limits);
      await memory.append({ scope, runId: "one", turn: 0, messages: [first] });
      await expect(
        memory.append({ scope, runId: "two", turn: 1, messages: [message("next")] }),
      ).rejects.toMatchObject({ kind: "resource_limit" });
      expect(await memory.load({ scope })).toEqual([first]);
    },
  );
});

describe("configuration and resource boundaries", () => {
  it("freezes limits without sharing caller overrides or mutable defaults", () => {
    const overrides = { maxSessions: 1 };
    const limits = resolveLimits(overrides);
    overrides.maxSessions = 99;
    expect(limits.maxSessions).toBe(1);
    expect(resolveLimits().maxSessions).toBe(32);
    expect(Object.isFrozen(limits)).toBe(true);
  });

  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid limits for every field: %s",
    (value) => {
      for (const key of Object.keys(resolveLimits()))
        expect(() => resolveLimits({ [key]: value })).toThrow(TypeError);
    },
  );

  it("snapshots host catalogs and returns isolated config and wire option objects", () => {
    const models = [
      { value: "first", name: "First" },
      { value: "second", name: "Second" },
    ];
    const commands = [{ name: "explain", description: "Explain", expand: () => "explain" }];
    const config = new SessionConfiguration({
      sessionFactory: () => makeAgent(),
      models,
      commands,
      readOnlyMode: true,
    });
    models[0]!.value = "mutated";
    commands[0]!.name = "mutated";
    const initial = config.initial();
    expect(initial).toEqual({ mode: "ask", model: "first" });
    expect(Object.isFrozen(initial)).toBe(true);
    expect(Object.isFrozen(config.models[0])).toBe(true);
    expect(Object.isFrozen(config.commands[0])).toBe(true);
    expect(config.commands[0]!.name).toBe("explain");
    const changed = config.change(initial, "model", "second");
    expect(config.change(changed, "mode", "read-only")).toEqual({
      mode: "read-only",
      model: "second",
    });
    expect(initial.model).toBe("first");
    config.options(initial)[1]!.options[0]!.name = "mutated output";
    expect(config.options(initial)[1]!.options[0]!.name).toBe("First");
  });

  it.each<Partial<AcpOptions>>([
    { models: [{ value: "", name: "Empty" }] },
    {
      models: [
        { value: "a", name: "A" },
        { value: "a", name: "Duplicate" },
      ],
    },
    { commands: [{ name: "/shell", description: "Invalid", expand: () => "" }] },
    { commands: [{ name: "empty", description: "", expand: () => "" }] },
    {
      commands: ["same", "same"].map((name) => ({
        name,
        description: "Duplicate",
        expand: () => "",
      })),
    },
  ])("rejects invalid host catalogs: %j", (options) => {
    expect(
      () => new SessionConfiguration({ sessionFactory: () => makeAgent(), ...options }),
    ).toThrow(new AcpError("configuration_error"));
  });

  it("rejects unknown selections and cannot enable an unoffered mode or model", () => {
    const config = new SessionConfiguration({ sessionFactory: () => makeAgent() });
    for (const [key, value] of [
      ["mode", "read-only"],
      ["model", "unlisted"],
      ["other", "ask"],
      ["mode", null],
    ])
      expect(() => config.change(config.initial(), key as string, value)).toThrow(
        new AcpError("invalid_config"),
      );
  });

  it("keeps errors to fixed public kinds and protocol codes", () => {
    for (const kind of Object.keys(errorCodes) as Array<keyof typeof errorCodes>) {
      const error = new AcpError(kind);
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe(kind);
      expect(error.name).toBe("AcpError");
      expect(Number.isInteger(errorCodes[error.kind])).toBe(true);
    }
  });
});

describe("whole-prompt budgets", () => {
  it.each<AcpTurnBudget>([
    { maxModelCalls: 0 },
    { maxModelCalls: 1.5 },
    { maxDurationMs: -1 },
    { maxDurationMs: 2 ** 31 },
    { maxCost: 1 },
    { maxCost: Infinity, estimateCost: () => 0 },
    { maxCost: 0, estimateCost: () => 0 },
  ])("rejects invalid budgets: %j", (options) => {
    expect(() => validateTurnBudget(options)).toThrow(TypeError);
  });

  it("validates the timer ceiling and preserves the original deadline across segments", () => {
    expect(() => validateTurnBudget({ maxDurationMs: 2 ** 31 - 1 })).not.toThrow();
    const clock = vi.spyOn(performance, "now").mockReturnValue(100);
    const budget = new TurnBudget({ maxDurationMs: 10 });
    clock.mockReturnValue(109);
    budget.segment();
    expect(() => budget.check()).not.toThrow();
    clock.mockReturnValue(110);
    expect(() => budget.check()).toThrow(TurnBudgetExceeded);
  });

  it.each([NaN, Infinity, -1])("rejects invalid cost estimates %s", async (cost) => {
    const budget = new TurnBudget({ maxCost: 10, estimateCost: () => cost });
    const usage = Usage.empty();
    await expect(async () =>
      budget.segment().onStepFinish!({
        runId: "fixture",
        step: 0,
        usage,
        response: { choice: [], usage, rawResponse: {} },
      }),
    ).rejects.toThrow("Invalid cost estimate");
  });

  it("does not refund cost if an estimator decreases and counts segment usage once", async () => {
    const estimateCost = vi
      .fn()
      .mockReturnValueOnce(8)
      .mockReturnValueOnce(2)
      .mockReturnValueOnce(10)
      .mockReturnValueOnce(2);
    const budget = new TurnBudget({ maxCost: 10, estimateCost });
    const step = (tokens: number) => {
      const usage = { ...Usage.empty(), totalTokens: tokens };
      return { runId: "fixture", step: 0, usage, response: { choice: [], usage, rawResponse: {} } };
    };
    const first = budget.segment();
    await first.onStepFinish!(step(1));
    await first.onStepFinish!(step(2));
    expect(() => budget.check()).not.toThrow();
    await expect(async () => budget.segment().onStepFinish!(step(3))).rejects.toThrow(
      TurnBudgetExceeded,
    );
    expect(estimateCost.mock.calls.map(([usage]) => usage.totalTokens)).toEqual([1, 2, 5]);
    await expect(async () => budget.segment().onStepFinish!(step(1))).rejects.toThrow(
      TurnBudgetExceeded,
    );
    expect(() => budget.check()).toThrow(TurnBudgetExceeded);
  });
});
