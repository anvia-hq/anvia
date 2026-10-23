import { type AnyTool, createTool, ToolOutput, type ToolCallContext } from "@anvia/core/tool";
import { z } from "zod";
import { type DesktopAction, desktopKeyPattern } from "./remote/protocol";
import type { SandboxDesktop } from "./remote/desktop";

const allDesktopToolNames = [
  "desktop_screenshot",
  "desktop_click",
  "desktop_mouse_move",
  "desktop_drag",
  "desktop_scroll",
  "desktop_type",
  "desktop_key",
  "desktop_cursor_position",
  "desktop_wait",
] as const;

export type DesktopToolName = (typeof allDesktopToolNames)[number];

/**
 * What `@anvia/durable` should do with each tool when a run is interrupted mid-call, for its
 * registration's `toolRecovery`. Reading the screen and waiting are `safe` to repeat. The inputs
 * are `idempotent`: they carry the run's `operationId`, so the daemon performs each once even if
 * the call is retried.
 */
export const desktopToolRecovery: Readonly<Record<DesktopToolName, "safe" | "idempotent">> = {
  desktop_screenshot: "safe",
  desktop_cursor_position: "safe",
  desktop_wait: "safe",
  desktop_click: "idempotent",
  desktop_mouse_move: "idempotent",
  desktop_drag: "idempotent",
  desktop_scroll: "idempotent",
  desktop_type: "idempotent",
  desktop_key: "idempotent",
};

export interface DesktopScreenshotPolicy {
  /** Longest side of the screenshot the model sees, in pixels. Default 1568. */
  maxEdge?: number;
  /** Most pixels in that screenshot. Default 1,150,000. */
  maxPixels?: number;
}

export interface CreateDesktopToolsOptions {
  sandbox: SandboxDesktop;
  /**
   * How long each input tool waits after acting, so the application can react before the next
   * input or screenshot. A model can send several inputs in one turn, and a program that is still
   * focusing a field loses keystrokes that arrive too soon (Chromium's address bar after ctrl+l
   * does). Default 300 ms; 0 turns it off.
   */
  settleMs?: number;
  /** The tools to expose. Default: all of them. Pass the read-only ones to let an agent only look. */
  tools?: readonly DesktopToolName[];
  screenshot?: DesktopScreenshotPolicy;
}

// Claude's computer-use guidance: images beyond these sizes are downscaled before the model sees
// them, so coordinates would drift. Scaling here first keeps what the model sees and what it
// clicks in one coordinate space.
const defaultSettleMs = 300;
const defaultMaxEdge = 1568;
const defaultMaxPixels = 1_150_000;
const maxWaitSeconds = 10;

/** `[x, y]` in the pixels of the latest screenshot, as Claude's computer-use tool takes it. */
const coordinate = z
  .array(z.number().int().min(0))
  .length(2)
  .describe("[x, y] in pixels of the latest screenshot, from its top-left corner.");

const button = z.enum(["left", "middle", "right"]);

const noInput = z.object({});
const okOutput = z.object({ ok: z.literal(true) });
const ok = { ok: true } as const;

const clickInput = z.object({
  coordinate: coordinate.optional().describe("Where to click. Omit to click where the cursor is."),
  button: button.optional().describe("Mouse button. Default left."),
  click_count: z
    .union([z.literal(1), z.literal(2), z.literal(3)])
    .optional()
    .describe("1 for a click, 2 for a double click, 3 for a triple click. Default 1."),
});
const mouseMoveInput = z.object({ coordinate });
const dragInput = z.object({
  start_coordinate: coordinate.optional().describe("Where to press. Omit to start at the cursor."),
  coordinate: coordinate.describe("Where to release, in pixels of the latest screenshot."),
});
const scrollInput = z.object({
  coordinate: coordinate.optional().describe("Where to scroll. Omit to scroll at the cursor."),
  scroll_direction: z.enum(["up", "down", "left", "right"]),
  scroll_amount: z.number().int().min(1).max(50).optional().describe("Wheel clicks. Default 3."),
});
const typeInput = z.object({
  text: z.string().min(1).max(20_000).describe("Text to type into the focused window."),
});
const keyInput = z.object({
  text: z
    .string()
    .regex(desktopKeyPattern, "Use key names like Return, Tab, ctrl+s, or alt+F4.")
    .describe("A key or combination, such as Return, Escape, ctrl+a, or alt+Tab."),
});
const waitInput = z.object({
  duration: z.number().min(0.1).max(maxWaitSeconds).describe("Seconds to wait, up to 10."),
});

/** How the display is shown to the model: the scaled size of its screenshots. */
interface View {
  displayWidth: number;
  displayHeight: number;
  scale: number;
  imageWidth: number;
  imageHeight: number;
}

/**
 * Tools that let an agent see and drive a sandbox desktop. They follow Claude's computer-use
 * conventions (`coordinate`, `start_coordinate`, `text`, `scroll_direction`, `scroll_amount`), and
 * coordinates are always pixels of the screenshot the model was shown, which is scaled to fit
 * Claude's image limits; the tools translate them to display pixels.
 *
 * They are separate tools rather than one `computer` tool so durable recovery can treat looking
 * and acting differently (see {@link desktopToolRecovery}). While a person has taken control of the
 * desktop, the input tools fail with the `desktop_locked` error code and say who holds it.
 */
export function createDesktopTools(options: CreateDesktopToolsOptions): readonly AnyTool[] {
  const { sandbox } = options;
  const policy = {
    maxEdge: options.screenshot?.maxEdge ?? defaultMaxEdge,
    maxPixels: options.screenshot?.maxPixels ?? defaultMaxPixels,
  };
  const wanted = new Set<DesktopToolName>(options.tools ?? allDesktopToolNames);
  for (const name of wanted) {
    if (!allDesktopToolNames.includes(name)) throw new TypeError(`Unknown desktop tool: ${name}`);
  }

  const view = async (abortSignal?: AbortSignal): Promise<View> => {
    const { width, height } = await sandbox.status({ abortSignal });
    return viewOf(width, height, policy);
  };
  /** Translate a point in the screenshot to display pixels, refusing one that is outside it. */
  const point = (current: View, [x = 0, y = 0]: readonly number[]) => toDisplay(current, x, y);
  const settleMs = options.settleMs ?? defaultSettleMs;
  if (!Number.isFinite(settleMs) || settleMs < 0) {
    throw new RangeError("settleMs must be zero or more.");
  }
  /** Perform an input, then give the application a moment to react to it. */
  const act = async (action: DesktopAction, context: ToolCallContext) => {
    await sandbox.act(action, {
      operationId: context.operationId,
      abortSignal: context.abortSignal,
    });
    if (settleMs > 0) await delay(settleMs, context.abortSignal);
  };

  const tools: Record<DesktopToolName, () => AnyTool> = {
    desktop_screenshot: () =>
      createTool({
        name: "desktop_screenshot",
        description:
          "Take a screenshot of the sandbox desktop. Coordinates in the other desktop tools are " +
          "pixels of this image, measured from its top-left corner.",
        inputSchema: noInput,
        execute: async (_args, context) => {
          const current = await view(context.abortSignal);
          const shot = await sandbox.screenshot({
            scale: current.scale < 1 ? current.scale : undefined,
            abortSignal: context.abortSignal,
          });
          return ToolOutput.content([
            { type: "text", text: JSON.stringify({ width: shot.width, height: shot.height }) },
            {
              type: "file",
              data: { type: "data", data: Buffer.from(shot.png).toString("base64") },
              mediaType: "image/png",
              filename: "screenshot.png",
            },
          ]);
        },
      }),
    desktop_click: () =>
      createTool({
        name: "desktop_click",
        description:
          "Click, double-click or triple-click on the sandbox desktop with the left, middle or " +
          "right button. Fails while a person has taken control of the desktop.",
        inputSchema: clickInput,
        outputSchema: okOutput,
        execute: async (args, context) => {
          const at =
            args.coordinate === undefined
              ? undefined
              : point(await view(context.abortSignal), args.coordinate);
          await act(
            { type: "click", x: at?.x, y: at?.y, button: args.button, count: args.click_count },
            context,
          );
          return ok;
        },
      }),
    desktop_mouse_move: () =>
      createTool({
        name: "desktop_mouse_move",
        description: "Move the mouse cursor to a point on the sandbox desktop.",
        inputSchema: mouseMoveInput,
        outputSchema: okOutput,
        execute: async (args, context) => {
          const at = point(await view(context.abortSignal), args.coordinate);
          await act({ type: "mouse_move", ...at }, context);
          return ok;
        },
      }),
    desktop_drag: () =>
      createTool({
        name: "desktop_drag",
        description:
          "Press the left button at start_coordinate (or the cursor), drag to coordinate and release.",
        inputSchema: dragInput,
        outputSchema: okOutput,
        execute: async (args, context) => {
          const current = await view(context.abortSignal);
          const to = point(current, args.coordinate);
          const from =
            args.start_coordinate === undefined ? undefined : point(current, args.start_coordinate);
          await act(
            { type: "drag", fromX: from?.x, fromY: from?.y, toX: to.x, toY: to.y },
            context,
          );
          return ok;
        },
      }),
    desktop_scroll: () =>
      createTool({
        name: "desktop_scroll",
        description: "Scroll the mouse wheel up, down, left or right, optionally at a point.",
        inputSchema: scrollInput,
        outputSchema: okOutput,
        execute: async (args, context) => {
          const at =
            args.coordinate === undefined
              ? undefined
              : point(await view(context.abortSignal), args.coordinate);
          await act(
            {
              type: "scroll",
              x: at?.x,
              y: at?.y,
              direction: args.scroll_direction,
              amount: args.scroll_amount,
            },
            context,
          );
          return ok;
        },
      }),
    desktop_type: () =>
      createTool({
        name: "desktop_type",
        description:
          "Type text into the focused window of the sandbox desktop, as keystrokes. Click the " +
          "field first. Use desktop_key for Return, Tab and shortcuts.",
        inputSchema: typeInput,
        outputSchema: okOutput,
        execute: async (args, context) => {
          await act({ type: "type", text: args.text }, context);
          return ok;
        },
      }),
    desktop_key: () =>
      createTool({
        name: "desktop_key",
        description:
          "Press a key or key combination on the sandbox desktop, such as Return, Tab, ctrl+s or alt+F4.",
        inputSchema: keyInput,
        outputSchema: okOutput,
        execute: async (args, context) => {
          await act({ type: "key", keys: args.text }, context);
          return ok;
        },
      }),
    desktop_cursor_position: () =>
      createTool({
        name: "desktop_cursor_position",
        description: "Get the mouse cursor's position, in pixels of the latest screenshot.",
        inputSchema: noInput,
        outputSchema: z.object({ coordinate: z.array(z.number().int()).length(2) }),
        execute: async (_args, context) => {
          const current = await view(context.abortSignal);
          const { x, y } = await sandbox.cursorPosition({ abortSignal: context.abortSignal });
          return {
            coordinate: [
              toImage(current.imageWidth, current.displayWidth, x),
              toImage(current.imageHeight, current.displayHeight, y),
            ],
          };
        },
      }),
    desktop_wait: () =>
      createTool({
        name: "desktop_wait",
        description: "Wait, for example for a page to load, before taking another screenshot.",
        inputSchema: waitInput,
        outputSchema: okOutput,
        execute: async (args, context) => {
          await delay(args.duration * 1_000, context.abortSignal);
          return ok;
        },
      }),
  };

  return allDesktopToolNames.filter((name) => wanted.has(name)).map((name) => tools[name]());
}

/** The size of the screenshots the model sees for a display this big. */
export function viewOf(
  displayWidth: number,
  displayHeight: number,
  policy: { maxEdge: number; maxPixels: number },
): View {
  const scale = Math.min(
    1,
    policy.maxEdge / Math.max(displayWidth, displayHeight),
    Math.sqrt(policy.maxPixels / (displayWidth * displayHeight)),
  );
  // The same rounding the daemon applies when it scales, so these sizes match its screenshots.
  return {
    displayWidth,
    displayHeight,
    scale,
    imageWidth: scale < 1 ? Math.max(1, Math.round(displayWidth * scale)) : displayWidth,
    imageHeight: scale < 1 ? Math.max(1, Math.round(displayHeight * scale)) : displayHeight,
  };
}

function toDisplay(view: View, x: number, y: number): { x: number; y: number } {
  if (x >= view.imageWidth || y >= view.imageHeight) {
    throw new RangeError(
      `The point (${x}, ${y}) is outside the ${view.imageWidth}x${view.imageHeight} screenshot; ` +
        `x is 0-${view.imageWidth - 1} and y is 0-${view.imageHeight - 1}. Take a new screenshot ` +
        "if the screen size changed.",
    );
  }
  // A screenshot pixel covers several display pixels when scaled down. Aim at its centre, so the
  // click lands where the model pointed and the display's far corner is reachable.
  return {
    x: Math.floor(((x + 0.5) * view.displayWidth) / view.imageWidth),
    y: Math.floor(((y + 0.5) * view.displayHeight) / view.imageHeight),
  };
}

/** The screenshot pixel a display pixel falls in: the inverse of {@link toDisplay}. */
function toImage(imageSize: number, displaySize: number, value: number): number {
  return Math.min(imageSize - 1, Math.floor((value * imageSize) / displaySize));
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) return reject(signal.reason);
    const timer = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener("abort", abort);
      resolve();
    }
    function abort() {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    }
    signal?.addEventListener("abort", abort, { once: true });
  });
}
