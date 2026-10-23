import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDesktopTools,
  desktopToolRecovery,
  type DesktopToolName,
} from "../src/desktop-tools";
import { viewOf } from "../src/desktop-tools";
import { DockerSandboxError } from "../src/errors";
import type { DesktopAction, SandboxDesktop } from "../src/remote/desktop";

afterEach(() => {
  vi.useRealTimers();
});

const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

/** A desktop that records what it is asked to do. `scale` rounds the way the daemon does. */
function fakeDesktop(width: number, height: number) {
  const status = { state: "running", width, height, control: { held: false } };
  const desktop = {
    status: vi.fn(async () => status),
    screenshot: vi.fn(async (options?: { scale?: number | undefined }) => {
      const scale = options?.scale ?? 1;
      return {
        png,
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale)),
        displayWidth: width,
        displayHeight: height,
      };
    }),
    cursorPosition: vi.fn(async () => ({ x: width / 2, y: height / 2 })),
    act: vi.fn(async (_action: DesktopAction, _options?: object) => undefined),
  };
  return desktop as typeof desktop & SandboxDesktop;
}

function tools(
  desktop: SandboxDesktop,
  options: { tools?: readonly DesktopToolName[]; settleMs?: number } = {},
) {
  // No settle delay unless a test asks for one: it would only slow the others down.
  const created = createDesktopTools({ sandbox: desktop, settleMs: 0, ...options });
  const call = (name: DesktopToolName, args: unknown, context: object = {}) => {
    const tool = created.find((candidate) => candidate.name === name);
    if (tool === undefined) throw new Error(`no tool ${name}`);
    return tool.call(args as never, context);
  };
  return { created, call };
}

const names = (created: readonly { name?: string }[]) => created.map((tool) => tool.name);

describe("createDesktopTools", () => {
  it("offers every tool, or just the ones asked for", () => {
    const desktop = fakeDesktop(1280, 800);
    expect(names(tools(desktop).created)).toEqual([
      "desktop_screenshot",
      "desktop_click",
      "desktop_mouse_move",
      "desktop_drag",
      "desktop_scroll",
      "desktop_type",
      "desktop_key",
      "desktop_cursor_position",
      "desktop_wait",
    ]);
    expect(
      names(tools(desktop, { tools: ["desktop_screenshot", "desktop_cursor_position"] }).created),
    ).toEqual(["desktop_screenshot", "desktop_cursor_position"]);
    expect(() => tools(desktop, { tools: ["desktop_fly" as DesktopToolName] })).toThrow(TypeError);
  });

  it("describes coordinates the way Claude's computer-use tool takes them", async () => {
    const { created } = tools(fakeDesktop(1280, 800));
    const schema = async (name: string) => {
      const tool = created.find((candidate) => candidate.name === name);
      return (await tool?.definition(""))?.parameters as {
        properties: Record<string, { type?: string; minItems?: number; maxItems?: number }>;
        required?: string[];
      };
    };
    const click = await schema("desktop_click");
    expect(Object.keys(click.properties)).toEqual(["coordinate", "button", "click_count"]);
    expect(click.properties.coordinate).toMatchObject({ type: "array", minItems: 2, maxItems: 2 });
    expect(click.required ?? []).toEqual([]);

    const drag = await schema("desktop_drag");
    expect(Object.keys(drag.properties)).toEqual(["start_coordinate", "coordinate"]);
    expect(drag.required).toEqual(["coordinate"]);

    expect(Object.keys((await schema("desktop_scroll")).properties)).toEqual([
      "coordinate",
      "scroll_direction",
      "scroll_amount",
    ]);
    expect(Object.keys((await schema("desktop_key")).properties)).toEqual(["text"]);
    expect(Object.keys((await schema("desktop_type")).properties)).toEqual(["text"]);
  });

  it("marks looking and waiting safe to repeat, and every input idempotent", () => {
    const { created } = tools(fakeDesktop(1280, 800));
    // Every tool has a recovery policy, and every policy names a real tool.
    expect(Object.keys(desktopToolRecovery).sort()).toEqual(names(created).sort());
    expect(desktopToolRecovery.desktop_screenshot).toBe("safe");
    expect(desktopToolRecovery.desktop_cursor_position).toBe("safe");
    expect(desktopToolRecovery.desktop_wait).toBe("safe");
    for (const name of [
      "desktop_click",
      "desktop_mouse_move",
      "desktop_drag",
      "desktop_scroll",
      "desktop_type",
      "desktop_key",
    ] as const) {
      expect(desktopToolRecovery[name]).toBe("idempotent");
    }
  });
});

describe("screenshots", () => {
  it("fits the screenshot to Claude's image limits before the model sees it", async () => {
    const desktop = fakeDesktop(2560, 1440);
    const { call } = tools(desktop);
    const output = await call("desktop_screenshot", {});

    const view = viewOf(2560, 1440, { maxEdge: 1568, maxPixels: 1_150_000 });
    expect(view.imageWidth).toBeLessThanOrEqual(1568);
    expect(view.imageWidth * view.imageHeight).toBeLessThanOrEqual(1_150_000);
    expect(desktop.screenshot).toHaveBeenCalledWith(expect.objectContaining({ scale: view.scale }));

    const content = (output as { content: Array<Record<string, unknown>> }).content;
    expect(JSON.parse(content[0]?.text as string)).toEqual({
      width: view.imageWidth,
      height: view.imageHeight,
    });
    expect(content[1]).toMatchObject({
      type: "file",
      mediaType: "image/png",
      data: { type: "data", data: Buffer.from(png).toString("base64") },
    });
  });

  it("does not scale a display that already fits", async () => {
    const desktop = fakeDesktop(1280, 800);
    await tools(desktop).call("desktop_screenshot", {});
    expect(desktop.screenshot).toHaveBeenCalledWith(expect.objectContaining({ scale: undefined }));
  });

  it("scales by whichever limit bites first, and never up", () => {
    const policy = { maxEdge: 1568, maxPixels: 1_150_000 };
    expect(viewOf(800, 600, policy)).toMatchObject({ scale: 1, imageWidth: 800, imageHeight: 600 });
    // Within the pixel limit but too long an edge.
    expect(viewOf(3000, 300, policy).imageWidth).toBe(1568);
    // Within the edge limit but too many pixels: 1568x1568 is 2.4 MP.
    const square = viewOf(1568, 1568, policy);
    expect(square.imageWidth * square.imageHeight).toBeLessThanOrEqual(1_150_000);
    expect(square.imageWidth).toBeLessThan(1568);
  });

  it("honours a different policy", async () => {
    const desktop = fakeDesktop(1280, 800);
    const created = createDesktopTools({
      sandbox: desktop,
      tools: ["desktop_screenshot"],
      screenshot: { maxEdge: 640 },
    });
    await created[0]?.call({} as never, {});
    expect(desktop.screenshot).toHaveBeenCalledWith(expect.objectContaining({ scale: 0.5 }));
  });
});

describe("coordinates", () => {
  it("translates points in the screenshot to display pixels", async () => {
    const desktop = fakeDesktop(2560, 1440);
    const { call } = tools(desktop);
    const view = viewOf(2560, 1440, { maxEdge: 1568, maxPixels: 1_150_000 });

    await call("desktop_click", { coordinate: [view.imageWidth / 2, view.imageHeight / 2] });
    await call("desktop_mouse_move", { coordinate: [0, 0] });
    await call("desktop_mouse_move", { coordinate: [view.imageWidth - 1, view.imageHeight - 1] });

    const [click, moveOrigin, moveCorner] = desktop.act.mock.calls.map(([action]) => action);
    // The middle of the screenshot is the middle of the display.
    expect(click).toMatchObject({ type: "click", x: 1280, y: 720 });
    expect(moveOrigin).toMatchObject({ type: "mouse_move", x: 0, y: 0 });
    // The far corner of the screenshot is the far corner of the display, not past it.
    expect(moveCorner).toMatchObject({ type: "mouse_move", x: 2559, y: 1439 });
  });

  it("uses the coordinates as they are when nothing was scaled", async () => {
    const desktop = fakeDesktop(1280, 800);
    await tools(desktop).call("desktop_click", {
      coordinate: [300, 200],
      button: "right",
      click_count: 2,
    });
    expect(desktop.act).toHaveBeenCalledWith(
      { type: "click", x: 300, y: 200, button: "right", count: 2 },
      expect.anything(),
    );
  });

  it("clicks where the cursor is when no coordinate is given", async () => {
    const desktop = fakeDesktop(1280, 800);
    await tools(desktop).call("desktop_click", {});
    expect(desktop.act.mock.calls[0]?.[0]).toMatchObject({
      type: "click",
      x: undefined,
      y: undefined,
    });
  });

  it("refuses a point outside the screenshot and says what the valid range is", async () => {
    const desktop = fakeDesktop(1280, 800);
    const { call } = tools(desktop);
    await expect(call("desktop_click", { coordinate: [1280, 10] })).rejects.toThrow(
      /outside the 1280x800 screenshot; x is 0-1279 and y is 0-799/,
    );
    await expect(
      call("desktop_drag", { start_coordinate: [1, 1], coordinate: [10, 800] }),
    ).rejects.toThrow(RangeError);
    expect(desktop.act).not.toHaveBeenCalled();
  });

  it("checks against the display as it is now, so a resize is noticed", async () => {
    const desktop = fakeDesktop(1280, 800);
    const { call } = tools(desktop);
    await call("desktop_mouse_move", { coordinate: [1000, 700] });
    desktop.status.mockResolvedValue({
      state: "running",
      width: 800,
      height: 600,
      control: { held: false },
    });
    await expect(call("desktop_mouse_move", { coordinate: [1000, 700] })).rejects.toThrow(
      /outside the 800x600 screenshot/,
    );
  });

  it("reports the cursor in screenshot coordinates", async () => {
    const desktop = fakeDesktop(2560, 1440);
    const view = viewOf(2560, 1440, { maxEdge: 1568, maxPixels: 1_150_000 });
    const output = await tools(desktop).call("desktop_cursor_position", {});
    expect(output).toEqual({
      coordinate: [Math.round(view.imageWidth / 2), Math.round(view.imageHeight / 2)],
    });
  });
});

describe("inputs", () => {
  it("passes drag, scroll, type and key through", async () => {
    const desktop = fakeDesktop(1280, 800);
    const { call } = tools(desktop);
    await call("desktop_drag", { start_coordinate: [10, 20], coordinate: [300, 400] });
    await call("desktop_scroll", {
      coordinate: [50, 60],
      scroll_direction: "down",
      scroll_amount: 5,
    });
    await call("desktop_scroll", { scroll_direction: "up" });
    await call("desktop_type", { text: "hello\n" });
    await call("desktop_key", { text: "ctrl+s" });

    expect(desktop.act.mock.calls.map(([action]) => action)).toEqual([
      { type: "drag", fromX: 10, fromY: 20, toX: 300, toY: 400 },
      { type: "scroll", x: 50, y: 60, direction: "down", amount: 5 },
      { type: "scroll", x: undefined, y: undefined, direction: "up", amount: undefined },
      { type: "type", text: "hello\n" },
      { type: "key", keys: "ctrl+s" },
    ]);
  });

  it("rejects arguments the schema does not allow, without touching the desktop", async () => {
    const desktop = fakeDesktop(1280, 800);
    const { call } = tools(desktop);
    await expect(call("desktop_click", { coordinate: [1] })).rejects.toThrow();
    await expect(call("desktop_click", { coordinate: [-1, 5] })).rejects.toThrow();
    await expect(call("desktop_click", { click_count: 4 })).rejects.toThrow();
    await expect(call("desktop_key", { text: "ctrl+c; rm -rf /" })).rejects.toThrow(/key names/);
    await expect(call("desktop_scroll", { scroll_direction: "sideways" })).rejects.toThrow();
    await expect(call("desktop_type", { text: "" })).rejects.toThrow();
    expect(desktop.act).not.toHaveBeenCalled();
    expect(desktop.status).not.toHaveBeenCalled();
  });

  it("hands the run's operationId and abort signal to every input", async () => {
    const desktop = fakeDesktop(1280, 800);
    const { call } = tools(desktop);
    const controller = new AbortController();
    const context = { operationId: "run/tool-1", abortSignal: controller.signal };
    await call("desktop_click", { coordinate: [1, 1] }, context);
    await call("desktop_mouse_move", { coordinate: [1, 1] }, context);
    await call("desktop_drag", { coordinate: [2, 2] }, context);
    await call("desktop_scroll", { scroll_direction: "down" }, context);
    await call("desktop_type", { text: "a" }, context);
    await call("desktop_key", { text: "Return" }, context);

    expect(desktop.act).toHaveBeenCalledTimes(6);
    for (const [, options] of desktop.act.mock.calls) {
      expect(options).toEqual({ operationId: "run/tool-1", abortSignal: controller.signal });
    }
  });

  it("surfaces the lock to the model as a typed error that says who holds control", async () => {
    const desktop = fakeDesktop(1280, 800);
    desktop.act.mockRejectedValue(
      new DockerSandboxError(
        "The desktop is controlled by alice; agent input is paused.",
        "desktop_locked",
      ),
    );
    const { call } = tools(desktop);
    for (const [name, args] of [
      ["desktop_click", { coordinate: [1, 1] }],
      ["desktop_type", { text: "x" }],
      ["desktop_key", { text: "Return" }],
    ] as const) {
      await expect(call(name, args)).rejects.toMatchObject({
        code: "desktop_locked",
        message: expect.stringContaining("alice"),
      });
    }
  });

  it("still lets the agent look while a person is in control", async () => {
    const desktop = fakeDesktop(1280, 800);
    desktop.act.mockRejectedValue(new DockerSandboxError("locked", "desktop_locked"));
    const { call } = tools(desktop);
    await expect(call("desktop_screenshot", {})).resolves.toBeDefined();
    await expect(call("desktop_cursor_position", {})).resolves.toBeDefined();
  });
});

describe("letting the application react", () => {
  it("waits 300 ms after an input by default, so the next one does not arrive too soon", async () => {
    vi.useFakeTimers();
    const desktop = fakeDesktop(1280, 800);
    const created = createDesktopTools({ sandbox: desktop });
    const key = created.find((tool) => tool.name === "desktop_key");
    let done = false;
    const running = Promise.resolve(key?.call({ text: "ctrl+l" } as never, {})).then(
      () => (done = true),
    );

    // The input has gone out, but the tool has not returned yet.
    await vi.advanceTimersByTimeAsync(0);
    expect(desktop.act).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(299);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    await running;
    expect(done).toBe(true);
  });

  it("applies to every input tool, and not to looking", async () => {
    vi.useFakeTimers();
    const desktop = fakeDesktop(1280, 800);
    const created = createDesktopTools({ sandbox: desktop, settleMs: 1_000 });
    const finished: string[] = [];
    const run = (name: string, args: unknown) =>
      Promise.resolve(created.find((tool) => tool.name === name)?.call(args as never, {})).then(
        () => finished.push(name),
      );
    const inputs: Array<[string, unknown]> = [
      ["desktop_click", { coordinate: [1, 1] }],
      ["desktop_mouse_move", { coordinate: [1, 1] }],
      ["desktop_drag", { coordinate: [2, 2] }],
      ["desktop_scroll", { scroll_direction: "down" }],
      ["desktop_type", { text: "a" }],
      ["desktop_key", { text: "Return" }],
    ];
    const pending = inputs.map(([name, args]) => run(name, args));
    const looking = [run("desktop_screenshot", {}), run("desktop_cursor_position", {})];

    await vi.advanceTimersByTimeAsync(10);
    // Looking is done; every input is still settling.
    expect(finished.sort()).toEqual(["desktop_cursor_position", "desktop_screenshot"]);
    await vi.advanceTimersByTimeAsync(1_000);
    await Promise.all([...pending, ...looking]);
    expect(finished).toHaveLength(8);
  });

  it("can be switched off, and stops when the run is cancelled", async () => {
    const desktop = fakeDesktop(1280, 800);
    const started = Date.now();
    await tools(desktop, { settleMs: 0 }).call("desktop_key", { text: "a" });
    expect(Date.now() - started).toBeLessThan(100);

    const controller = new AbortController();
    const slow = createDesktopTools({ sandbox: desktop, settleMs: 60_000 }).find(
      (tool) => tool.name === "desktop_key",
    );
    const settling = Promise.resolve(
      slow?.call({ text: "a" } as never, { abortSignal: controller.signal }),
    );
    const assertion = expect(settling).rejects.toMatchObject({ name: "AbortError" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    controller.abort();
    await assertion;
  });

  it("refuses a negative or non-numeric delay", () => {
    const desktop = fakeDesktop(1280, 800);
    expect(() => createDesktopTools({ sandbox: desktop, settleMs: -1 })).toThrow(RangeError);
    expect(() => createDesktopTools({ sandbox: desktop, settleMs: Number.NaN })).toThrow(
      RangeError,
    );
  });
});

describe("desktop_wait", () => {
  it("waits for the duration", async () => {
    vi.useFakeTimers();
    const { call } = tools(fakeDesktop(1280, 800));
    let done = false;
    const waiting = Promise.resolve(call("desktop_wait", { duration: 2 })).then(
      () => (done = true),
    );
    await vi.advanceTimersByTimeAsync(1_999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    await waiting;
    expect(done).toBe(true);
  });

  it("stops when the run is cancelled, and is capped at ten seconds", async () => {
    const { call } = tools(fakeDesktop(1280, 800));
    const controller = new AbortController();
    const waiting = call("desktop_wait", { duration: 5 }, { abortSignal: controller.signal });
    const assertion = expect(waiting).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await assertion;
    await expect(call("desktop_wait", { duration: 11 })).rejects.toThrow();
  });
});
