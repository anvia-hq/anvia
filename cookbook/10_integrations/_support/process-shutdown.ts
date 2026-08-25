export function createProcessShutdownSignal(): {
  readonly signal: AbortSignal;
  dispose(): void;
} {
  const controller = new AbortController();
  const abortFor = (signal: "SIGINT" | "SIGTERM") => {
    process.exitCode = signal === "SIGINT" ? 130 : 143;
    controller.abort(new Error(`Process received ${signal}.`));
  };
  const sigint = () => abortFor("SIGINT");
  const sigterm = () => abortFor("SIGTERM");
  process.once("SIGINT", sigint);
  process.once("SIGTERM", sigterm);
  return {
    signal: controller.signal,
    dispose() {
      process.off("SIGINT", sigint);
      process.off("SIGTERM", sigterm);
    },
  };
}
