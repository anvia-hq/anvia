import { describe, expect, it } from "vitest";
import { datetime } from "../src/tools/datetime";
import { evaluateMathExpression, math } from "../src/tools/math";
import { InMemoryScratchpadStore, scratchpad } from "../src/tools/scratchpad";

describe("datetime toolkit", () => {
  it("returns current time, converts timezones, and performs exact date math", async () => {
    const fixed = new Date("2026-01-31T10:00:00.000Z");
    const kit = datetime({ defaultTimeZone: "UTC", now: () => fixed });
    const byName = new Map(kit.tools.map((tool) => [tool.name, tool]));

    const current = (await byName.get("current_time")!.call({})) as {
      isoUtc: string;
      timeZone: string;
      weekday: string;
    };
    expect(current.isoUtc).toBe("2026-01-31T10:00:00.000Z");
    expect(current.timeZone).toBe("UTC");
    expect(current.weekday).toBe("Saturday");

    const converted = (await byName.get("convert_timezone")!.call({
      timestamp: "2026-01-31T10:00:00.000Z",
      toTimeZone: "Asia/Tokyo",
    })) as { formatted: string; timeZone: string };
    expect(converted.timeZone).toBe("Asia/Tokyo");
    expect(converted.formatted).toBe("2026-01-31 19:00:00");

    const clampedMonth = (await byName.get("date_math")!.call({
      timestamp: "2026-01-31T10:00:00.000Z",
      operation: "add",
      amount: 1,
      unit: "months",
    })) as { result: string };
    expect(clampedMonth.result).toBe("2026-02-28T10:00:00.000Z");

    const lowYear = (await byName.get("date_math")!.call({
      timestamp: "2026-01-31T10:00:00.000Z",
      operation: "subtract",
      amount: 2000,
      unit: "years",
    })) as { result: string };
    expect(lowYear.result).toBe("0026-01-31T10:00:00.000Z");

    const diff = (await byName.get("date_math")!.call({
      timestamp: "2026-01-01T00:00:00.000Z",
      operation: "diff",
      otherTimestamp: "2026-01-03T12:00:00.000Z",
    })) as { hours: number; days: number };
    expect(diff.hours).toBe(60);
    expect(diff.days).toBe(2.5);

    expect(() => datetime({ defaultTimeZone: "Not/A_Zone" })).toThrow(/Invalid IANA timeZone/);
  });
});

describe("scratchpad toolkit", () => {
  it("stores, reads, lists by prefix, deletes notes, and enforces limits", async () => {
    const store = new InMemoryScratchpadStore({
      maxEntries: 2,
      maxValueChars: 20,
      now: () => "2026-11-28T00:00:00.000Z",
    });
    const kit = scratchpad({ store });
    const byName = new Map(kit.tools.map((tool) => [tool.name, tool]));

    await byName.get("note_set")!.call({ key: "plan:step1", value: "inspect repo" });
    await byName.get("note_set")!.call({ key: "fact:owner", value: "anvia" });

    await expect(byName.get("note_set")!.call({ key: "extra", value: "too many" })).rejects.toThrow(
      /maxEntries/,
    );

    await expect(
      byName.get("note_set")!.call({ key: "fact:owner", value: "x".repeat(25) }),
    ).rejects.toThrow(/maxValueChars/);

    const got = (await byName.get("note_get")!.call({ key: "plan:step1" })) as {
      found: boolean;
      value: string;
    };
    expect(got.found).toBe(true);
    expect(got.value).toBe("inspect repo");

    const listed = (await byName.get("note_list")!.call({ prefix: "plan:" })) as {
      count: number;
      keys: { key: string }[];
    };
    expect(listed.count).toBe(1);
    expect(listed.keys[0]!.key).toBe("plan:step1");

    const deleted = (await byName.get("note_delete")!.call({ key: "plan:step1" })) as {
      deleted: boolean;
    };
    expect(deleted.deleted).toBe(true);
    expect(await byName.get("note_get")!.call({ key: "plan:step1" })).toEqual({
      found: false,
      key: "plan:step1",
    });
  });
});

describe("math toolkit", () => {
  it("evaluates arithmetic, precedence, right-associative power, constants, and functions safely", async () => {
    expect(evaluateMathExpression("2 + 3 * 4")).toBe(14);
    expect(evaluateMathExpression("(2 + 3) * 4")).toBe(20);
    expect(evaluateMathExpression("2 ^ 3 ^ 2")).toBe(512);
    expect(evaluateMathExpression("-3 ^ 2")).toBe(-9);
    expect(evaluateMathExpression("sqrt(16) + max(2, 9, 4) + round(pi)")).toBe(16);
    expect(evaluateMathExpression("1.5e2 / 3")).toBe(50);

    const kit = math();
    const res = (await kit.tools[0]!.call({ expression: "1 / 3", precision: 4 })) as {
      result: number;
    };
    expect(res.result).toBe(0.3333);

    expect(() => evaluateMathExpression("10 / 0")).toThrow(/Division by zero/);
    expect(() => evaluateMathExpression("constructor(5) * 2")).toThrow(/Unknown math function/);
    expect(() => evaluateMathExpression("__proto__()")).toThrow(/Unknown math function/);
    expect(() => evaluateMathExpression("process.exit(1)")).toThrow();
    expect(() => evaluateMathExpression("(".repeat(100) + "1" + ")".repeat(100))).toThrow(
      /nesting depth/,
    );
  });
});
