import { expect, it } from "vitest";
import { DurableRuntime } from "../src/index.js";
import { SqliteDurableStore } from "../src/sqlite.js";
import { makeAgent, response } from "./helpers.js";

async function eventsOf(run: { stream(): AsyncIterable<{ type: string; data: unknown }> }) {
  const events = [];
  for await (const event of run.stream()) events.push(event);
  return events;
}

it("keeps status events small when the outcome is large, and leaves the outcome on the run", async () => {
  // The outcome repeats the text (output, text and the assistant message), so about 600 KB here.
  const text = "o".repeat(200_000);
  const runtime = await DurableRuntime.open({
    store: new SqliteDurableStore(":memory:"),
    agents: [{ agent: makeAgent(async () => response([{ type: "text", text }])), version: "1" }],
  });
  try {
    const run = await runtime.submit({
      agentId: "researcher",
      sessionId: "session",
      requestId: "request-1",
      prompt: "hello",
    });
    await run.result();

    const statuses = (await eventsOf(run)).filter((event) => event.type === "status");
    expect(statuses.map((event) => (event.data as { status: string }).status)).toEqual([
      "running",
      "completed",
    ]);
    for (const event of statuses) {
      // Only the small fields: status, error, blocked operation and retry time. No outcome.
      expect(JSON.stringify(event.data).length).toBeLessThan(512);
      expect(event.data).not.toHaveProperty("outcome");
    }

    // The outcome is still complete on the run record, which is where clients read it.
    const snapshot = await run.snapshot();
    expect(snapshot.run.status).toBe("completed");
    expect(snapshot.run.outcome).toMatchObject({ type: "response", text });
  } finally {
    await runtime.close();
  }
});
