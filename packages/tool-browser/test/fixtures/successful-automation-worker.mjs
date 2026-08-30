import { loaded } from "./successful-automation-worker-dependency.mjs";

if (!loaded) process.exit(1);

process.on("message", (message) => {
  if (message.kind === "cancel") {
    process.send?.({ kind: "cancelled", id: message.id });
    return;
  }
  process.send?.({ kind: "response", id: message.id, ok: true, value: undefined });
});
