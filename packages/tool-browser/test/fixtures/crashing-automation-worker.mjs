process.on("message", (message) => {
  if (message?.kind !== "request") return;
  process.send?.({ kind: "response", id: message.id, ok: true, value: null }, () => {
    if (message.method === "connect") return;
    setImmediate(() => {
      throw new Error("simulated late Playwright protocol assertion");
    });
  });
});
