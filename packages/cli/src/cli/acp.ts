/** Load ACP only for the server command; scaffolding works without the optional peer. */
export async function runAcp(modulePath: string): Promise<void> {
  try {
    import.meta.resolve("@anvia/acp/launcher");
  } catch {
    throw new Error(
      "anvia acp requires @anvia/acp. Install it with `pnpm add @anvia/acp @anvia/core`.",
    );
  }

  let launcher: typeof import("@anvia/acp/launcher");
  try {
    launcher = await import("@anvia/acp/launcher");
  } catch {
    // A broken ACP installation can contain provider errors too; never print the raw cause.
    throw new Error(
      "anvia acp: cannot load @anvia/acp; check its installation and peer dependencies.",
    );
  }
  await launcher.runStdioServer(modulePath);
}
