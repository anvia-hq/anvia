import type { SandboxPortSession, SandboxProcessSession, SandboxSession } from "./types";

export function isSandboxPortSession(session: SandboxSession): session is SandboxPortSession {
  const candidate = session as Partial<SandboxPortSession>;
  return Array.isArray(candidate.publishedPorts) && typeof candidate.waitForPort === "function";
}

export function isSandboxProcessSession(session: SandboxSession): session is SandboxProcessSession {
  const candidate = session as Partial<SandboxProcessSession>;
  return (
    typeof candidate.startProcess === "function" &&
    typeof candidate.listProcesses === "function" &&
    typeof candidate.readProcessLogs === "function" &&
    typeof candidate.stopProcess === "function"
  );
}
