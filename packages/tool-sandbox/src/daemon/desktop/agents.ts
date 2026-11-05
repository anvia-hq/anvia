import { readdir, readFile } from "node:fs/promises";

/**
 * The variable every program a desktop starts inherits, holding that desktop's random id. A
 * helper that daemonizes (ssh-agent, gpg-agent) keeps its environment, so the id still finds it
 * after its process group is gone and it has been re-parented to init.
 */
export const desktopSessionVariable = "ANVIA_DESKTOP_SESSION";

/**
 * The agents a desktop's window manager autostart starts. Only these names are stopped, and only
 * when they carry the desktop's session id; agents started elsewhere are left alone.
 */
export const desktopAgentNames: readonly string[] = ["ssh-agent", "gpg-agent"];

export interface DesktopAgentOptions {
  /** How long the agents get to exit after SIGTERM before they are killed. */
  graceMs?: number;
  /** The process table to read. Defaults to `/proc`. */
  procRoot?: string;
}

/** Processes that are agents of the given desktop session, found by name and by environment. */
export async function findDesktopAgents(
  session: string,
  procRoot = "/proc",
): Promise<Array<{ pid: number; name: string }>> {
  let entries: string[];
  try {
    entries = await readdir(procRoot);
  } catch {
    return []; // No process table (not Linux): nothing to find.
  }
  const marker = `${desktopSessionVariable}=${session}`;
  const found: Array<{ pid: number; name: string }> = [];
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const name = (await readFile(`${procRoot}/${entry}/comm`, "utf8")).trim();
      if (!desktopAgentNames.includes(name)) continue;
      const environment = await readFile(`${procRoot}/${entry}/environ`, "utf8");
      if (environment.split("\0").includes(marker)) found.push({ pid: Number(entry), name });
    } catch {
      // The process exited while it was being read, or belongs to another user.
    }
  }
  return found;
}

/**
 * Stops the agents a desktop started: SIGTERM, then SIGKILL for any still running after the grace
 * period. Only processes that still match the session are signalled, so a process that exited and
 * whose id was reused is not touched.
 */
export async function stopDesktopAgents(
  session: string,
  options: DesktopAgentOptions = {},
): Promise<void> {
  const { graceMs = 2_000, procRoot = "/proc" } = options;
  const agents = await findDesktopAgents(session, procRoot);
  for (const agent of agents) signal(agent.pid, "SIGTERM");
  const deadline = Date.now() + graceMs;
  while (
    (await Promise.all(agents.map((agent) => isRunning(procRoot, agent.pid)))).some(Boolean) &&
    Date.now() < deadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const stubborn = (await findDesktopAgents(session, procRoot)).filter((agent) =>
    agents.some((known) => known.pid === agent.pid),
  );
  for (const agent of stubborn) signal(agent.pid, "SIGKILL");
}

function signal(pid: number, name: NodeJS.Signals): void {
  try {
    process.kill(pid, name);
  } catch {
    // Already gone.
  }
}

/** A zombie has exited already; it only waits for its parent, so it does not count as running. */
async function isRunning(procRoot: string, pid: number): Promise<boolean> {
  try {
    const stat = await readFile(`${procRoot}/${pid}/stat`, "utf8");
    const state = stat.slice(stat.lastIndexOf(")") + 2, stat.lastIndexOf(")") + 3);
    return state !== "Z" && state !== "X" && state !== "";
  } catch {
    return false;
  }
}
