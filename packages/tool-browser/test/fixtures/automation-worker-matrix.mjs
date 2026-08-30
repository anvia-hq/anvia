import { fork } from "node:child_process";

const workerUrl = new URL("../../dist/automation-worker.js", import.meta.url);
const cycles = Number(process.env.ANVIA_BROWSER_REPRO_CYCLES ?? "1");
const lingerMs = Number(process.env.ANVIA_BROWSER_REPRO_LINGER_MS ?? "0");

for (let cycle = 1; cycle <= cycles; cycle += 1) {
  await runCycle(cycle);
  if (lingerMs > 0) await new Promise((resolve) => setTimeout(resolve, lingerMs));
}

async function runCycle(cycle) {
  const child = fork(workerUrl, [], {
    execArgv: [],
    serialization: "advanced",
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  const messages = await new Promise((resolve, reject) => {
    const received = [];
    let count = 0;
    const timer = setTimeout(() => reject(new Error("worker response timeout")), 5_000);
    child.on("message", (value) => {
      count += 1;
      if (received.length < 8) received.push(summarize(value));
      if (value?.kind !== "response") return;
      clearTimeout(timer);
      resolve({ count, firstMessages: received });
    });
    child.once("error", reject);
    child.send({ kind: "request", id: 1, method: "disconnect", params: {} });
  });
  process.stdout.write(
    `${JSON.stringify({
      cycle,
      parentHasIpc: process.connected === true,
      parentSerializationMode: process.env.NODE_CHANNEL_SERIALIZATION_MODE,
      responses: messages,
    })}\n`,
  );
  child.kill("SIGTERM");
  await new Promise((resolve) => child.once("exit", resolve));
}

function summarize(value) {
  const isObject = value !== null && typeof value === "object";
  const prototype = isObject ? Object.getPrototypeOf(value) : undefined;
  const safePropertyNames = new Set([
    "error",
    "event",
    "id",
    "kind",
    "ok",
    "value",
    "watch:import",
    "watch:require",
  ]);
  return {
    type: value === null ? "null" : Array.isArray(value) ? "array" : typeof value,
    ownPropertyNames: isObject
      ? Object.getOwnPropertyNames(value)
          .slice(0, 12)
          .map((name) => (safePropertyNames.has(name) ? name : "<other>"))
      : [],
    kind:
      !isObject || value.kind === undefined
        ? undefined
        : value.kind === "response" || value.kind === "cancelled" || value.kind === "event"
          ? value.kind
          : "other",
    id: isObject && typeof value.id === "number" ? value.id : undefined,
    ok: isObject && typeof value.ok === "boolean" ? value.ok : undefined,
    constructorName: !isObject
      ? undefined
      : prototype === null
        ? "null-prototype"
        : prototype === Object.prototype
          ? "Object"
          : "other",
    expectedPrototype: isObject && prototype === Object.prototype,
    hasRequiredFields:
      isObject &&
      value.kind === "response" &&
      Number.isSafeInteger(value.id) &&
      typeof value.ok === "boolean" &&
      (value.ok ? Object.hasOwn(value, "value") : Object.hasOwn(value, "error")),
  };
}
