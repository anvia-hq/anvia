import {
  desktopCapability,
  terminalCapability,
  terminalTmuxCapability,
  tunnelCapability,
} from "../remote/protocol";
import { DesktopService } from "./desktop/service";
import type { LocalSandbox } from "./local-sandbox";
import { TerminalManager, detectTmux } from "./terminal/manager";
import { loadNodePty } from "./terminal/pty";
import type { SandboxDaemonLogLevel, SandboxDaemonOptions } from "./daemon";

/** The optional things this daemon can do, found once by looking at what is installed. */
export interface DaemonFeatures {
  terminals: TerminalManager | undefined;
  desktop: DesktopService | undefined;
  /** What `hello` advertises. A hub never asks for a feature that is not listed. */
  capabilities: string[];
}

/**
 * Look for terminal and desktop support. It happens once, at the first connection, and the result
 * decides which capabilities `hello` advertises; a feature switched off or missing its programs is
 * simply absent, never half there.
 */
export async function detectFeatures(
  options: Pick<SandboxDaemonOptions, "terminal" | "tunnel" | "desktop">,
  sandbox: LocalSandbox,
  log: (level: SandboxDaemonLogLevel, message: string) => void,
): Promise<DaemonFeatures> {
  const terminals = await detectTerminals(options.terminal, sandbox, log);
  const desktop = await detectDesktop(options.desktop, sandbox, log);
  const capabilities: string[] = [];
  if (terminals !== undefined) {
    capabilities.push(terminalCapability);
    if (terminals.persistent) capabilities.push(terminalTmuxCapability);
  }
  if (options.tunnel !== false) capabilities.push(tunnelCapability);
  if (desktop !== undefined) capabilities.push(desktopCapability);
  return { terminals, desktop, capabilities };
}

async function detectTerminals(
  config: SandboxDaemonOptions["terminal"],
  sandbox: LocalSandbox,
  log: (level: SandboxDaemonLogLevel, message: string) => void,
): Promise<TerminalManager | undefined> {
  if (config === false) return undefined;
  const spawn = config?.spawn ?? (await loadNodePty());
  if (spawn === undefined) {
    log("info", "terminals unavailable: node-pty is not installed");
    return undefined;
  }
  const tmuxPath =
    config?.tmuxPath === false ? undefined : await detectTmux(config?.tmuxPath ?? "tmux");
  log("info", `terminals enabled (${tmuxPath === undefined ? "plain shell" : "tmux"})`);
  return new TerminalManager({
    spawn,
    tmuxPath,
    socketName: config?.socketName,
    scrollbackBytes: config?.scrollbackBytes,
    maxSessions: config?.maxSessions,
    commandEnv: () => sandbox.commandEnvironment(),
  });
}

async function detectDesktop(
  config: SandboxDaemonOptions["desktop"],
  sandbox: LocalSandbox,
  log: (level: SandboxDaemonLogLevel, message: string) => void,
): Promise<DesktopService | undefined> {
  if (config === false) return undefined;
  const found = await DesktopService.detect(config, {
    env: () => sandbox.commandEnvironment(),
    log: (message) => log("info", `desktop: ${message}`),
  });
  if ("missing" in found) {
    log("info", `desktop unavailable: ${found.missing.join(", ")} not installed`);
    return undefined;
  }
  log("info", "desktop available (starts on first use)");
  return found.service;
}
