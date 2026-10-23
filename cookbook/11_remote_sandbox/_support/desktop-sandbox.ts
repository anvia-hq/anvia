import { type ChildProcess, spawn } from "node:child_process";
import { AnthropicClient } from "@anvia/anthropic";
import { Agent, type AgentLifecycle } from "@anvia/core/agent";
import { createDesktopTools, type SandboxDesktop } from "@anvia/sandbox";
import type { RemoteSandboxHub } from "@anvia/sandbox/remote";

// What the desktop examples share: starting a desktop sandbox, and an agent that can drive it.

export const sandboxId = "desktop-demo";
export const defaultImage = process.env.ANVIA_DESKTOP_IMAGE ?? "anvia-desktop";

export const defaultTask =
  "In the browser that is already open, go to https://example.com. Then tell me the title " +
  "shown in the browser tab and the first sentence of the text on the page.";

export interface DesktopSandbox {
  desktop: SandboxDesktop;
  /** Stops the container. The hub is the caller's to close. */
  stop(): Promise<void>;
}

/**
 * Start the reference desktop image and wait for its daemon to connect to `hub`, then start the
 * desktop and open a browser on it. The daemon dials OUT to the hub, so the container needs no
 * published ports. On Linux, host.docker.internal needs the host-gateway mapping; Docker Desktop
 * provides it already and accepts the flag.
 */
export async function startDesktopSandbox(options: {
  hub: RemoteSandboxHub;
  /** The port the hub accepts daemons on, and the token its `authorize` expects. */
  hubPort: number;
  daemonToken: string;
  /** The path the hub serves daemons on. Default `/daemon`. */
  daemonPath?: string;
  image?: string;
}): Promise<DesktopSandbox> {
  const image = options.image ?? defaultImage;
  const containerName = `anvia-${sandboxId}-${process.pid}`;
  const container: ChildProcess = spawn(
    "docker",
    [
      "run",
      "--rm",
      `--name=${containerName}`,
      "--add-host=host.docker.internal:host-gateway",
      `--env=ANVIA_CONTROL_URL=ws://host.docker.internal:${options.hubPort}${options.daemonPath ?? "/daemon"}`,
      `--env=ANVIA_SANDBOX_TOKEN=${options.daemonToken}`,
      image,
    ],
    { stdio: ["ignore", "ignore", process.env.ANVIA_DEMO_VERBOSE ? "inherit" : "ignore"] },
  );
  const stop = async () => {
    spawn("docker", ["rm", "-f", containerName], { stdio: "ignore" });
    container.kill();
  };

  try {
    const desktop = options.hub.desktop(sandboxId);
    const status = await desktop.start(); // Waits for the daemon, then starts the display.
    await options.hub.runtime(sandboxId).startProcess({
      command: "anvia-chromium",
      args: [
        "--window-position=0,0",
        `--window-size=${status.width},${status.height}`,
        "about:blank",
      ],
      env: { DISPLAY: status.display, HOME: "/home/node" },
    });
    return { desktop, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}

export function requireAnthropicKey(): string {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("Set ANTHROPIC_API_KEY (in the repo's .env, or the environment).");
  return key;
}

/** An agent with the desktop tools, and instructions on how to use them. */
export function createDesktopAgent(options: {
  desktop: SandboxDesktop;
  lifecycle?: AgentLifecycle;
}) {
  const client = new AnthropicClient({
    apiKey: requireAnthropicKey(),
    baseUrl: process.env.ANTHROPIC_BASEURL,
  });
  return new Agent({
    id: "desktop-agent",
    model: client.completionModel({
      modelId: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5",
    }),
    instructions: [
      "You operate a Linux desktop through screenshots and input tools.",
      "Take a screenshot before you act, and again after anything that changes the screen.",
      "Coordinates are pixels of the most recent screenshot, from its top-left corner.",
      "To open a URL in the browser: press ctrl+l, type the address, press Return, wait a few " +
        "seconds, then take a screenshot.",
      "If an input fails saying the desktop is controlled by someone else, a person has taken " +
        "control. Do not keep trying: wait with desktop_wait, then take a screenshot and try again.",
      "When you have the answer, reply with it plainly.",
    ].join("\n"),
    maxTurns: 40,
    tools: createDesktopTools({ sandbox: options.desktop }),
    lifecycle: options.lifecycle,
  });
}

/** A tool failure's message, without the stack. */
export function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
