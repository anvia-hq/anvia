import { Agent } from "@anvia/core/agent";
import { Usage, type StreamingCompletionModel } from "@anvia/core/completion";
import { getEventListeners } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
import { SessionManager } from "../src/session-manager.js";
import { deferred } from "./helpers.js";

afterEach(() => vi.useRealTimers());

it.each(["cancel", "close"])(
  "releases listeners, deadlines, pending requests and session maps after a long stream and %s",
  async (action) => {
    const delta = "x".repeat(128);
    let openStreams = 0;
    let hold = false;
    let currentSignal: AbortSignal | undefined;
    let callbackSignal: AbortSignal | undefined;
    const waiting = deferred();
    let current!: ReturnType<SessionManager["get"]>;
    const model: StreamingCompletionModel = {
      provider: "fake",
      modelId: "stress",
      capabilities: {
        streaming: true,
        tools: false,
        toolChoice: false,
        imageInput: false,
        documentInput: false,
        outputSchema: false,
        reasoning: false,
      },
      async completion() {
        throw new Error("Use streaming.");
      },
      async *streamCompletion(_request, options) {
        openStreams++;
        currentSignal = options!.abortSignal!;
        try {
          for (let i = 0; i < 256; i++) yield { type: "text_delta", delta };
          if (hold) {
            await current.pendingRequests.run((signal) => {
              callbackSignal = signal;
              waiting.resolve();
              return new Promise<never>((_resolve, reject) => {
                const abort = () => {
                  signal.removeEventListener("abort", abort);
                  reject(signal.reason);
                };
                signal.addEventListener("abort", abort, { once: true });
              });
            });
          }
          yield {
            type: "final",
            response: {
              choice: [{ type: "text", text: delta.repeat(256) }],
              usage: Usage.empty(),
              rawResponse: {},
            },
          };
        } finally {
          openStreams--;
        }
      },
    };
    const dispose = vi.fn();
    const manager = new SessionManager({
      sessionFactory: () => ({
        agent: new Agent({ id: "stress", model, retries: false }),
        dispose,
        turnBudget: { maxDurationMs: 60_000 },
      }),
    });
    const id = await manager.create(process.cwd(), {
      readTextFile: false,
      writeTextFile: false,
      terminal: false,
      elicitationForm: false,
    });
    current = manager.get(id);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let updates = 0;
    try {
      for (let i = 0; i < 64; i++) {
        expect(
          await current.prompt([{ type: "text", text: `turn ${i}` }], async () => {
            updates++;
          }),
        ).toBe("end_turn");
        expect(current.pendingRequests.size).toBe(0);
        expect(getEventListeners(current.context.signal, "abort")).toHaveLength(0);
        expect(getEventListeners(currentSignal!, "abort")).toHaveLength(0);
        expect(vi.getTimerCount()).toBe(0);
        expect(openStreams).toBe(0);
      }
      expect(updates).toBe(64 * 256);
      // Stored replay stays compact; the live stream still delivered every delta.
      expect(current.transcript()).toHaveLength(128);
      hold = true;
      const pending = current.prompt([{ type: "text", text: "wait" }], async () => {
        updates++;
      });
      const settled = pending.catch((error: unknown) => error);
      await waiting.promise;
      expect(current.pendingRequests.size).toBe(1);
      const before = updates;
      if (action === "cancel") {
        await current.cancel();
        expect(await settled).toBe("cancelled");
      } else {
        await manager.close();
        expect(await settled).toMatchObject({ kind: "connection_closed" });
      }
      await manager.close();
      expect(updates).toBe(before);
      expect(openStreams).toBe(0);
      expect(current.pendingRequests.size).toBe(0);
      expect(getEventListeners(current.context.signal, "abort")).toHaveLength(0);
      expect(getEventListeners(currentSignal!, "abort")).toHaveLength(0);
      expect(getEventListeners(callbackSignal!, "abort")).toHaveLength(0);
      expect(vi.getTimerCount()).toBe(0);
      expect(dispose).toHaveBeenCalledOnce();
      expect(current.busy).toBe(false);
      expect(await current.memory.load({ scope: { sessionId: id } })).toEqual([]);
      // Inspect ownership registries without exposing a new production diagnostics API.
      const state = manager as unknown as {
        sessions: Map<unknown, unknown>;
        setups: Map<unknown, unknown>;
        operations: Map<unknown, unknown>;
      };
      expect([state.sessions.size, state.setups.size, state.operations.size]).toEqual([0, 0, 0]);
    } finally {
      await manager.close();
    }
  },
);
