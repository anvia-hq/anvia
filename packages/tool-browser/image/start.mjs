import { spawn } from "node:child_process";
import { writeSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { chromium } from "playwright-core";

const configPath = "/home/pwuser/.anvia-browser/config.json";
const profilePath = "/workspace/chromium-profile";
const downloadsPath = "/workspace/downloads";
const display = ":99";
const chromiumCdpPort = 9223;

const config = await readConfiguration();
await mkdir(profilePath, { recursive: true });
await mkdir(downloadsPath, { recursive: true });
await mkdir("/tmp/anvia-browser-runtime", { recursive: true });

const services = [
  service("xvfb", "Xvfb", [
    display,
    "-screen",
    "0",
    `${config.width}x${config.height}x24`,
    "-nolisten",
    "tcp",
  ]),
];
await delay(250);
services.push(
  service("openbox", "openbox", [], { DISPLAY: display }),
  service(
    "vnc",
    "x11vnc",
    [
      "-display",
      display,
      "-rfbauth",
      config.passwordPath,
      "-rfbport",
      "5900",
      "-localhost",
      "-forever",
      "-shared",
      "-noxdamage",
    ],
    { DISPLAY: display },
  ),
  service("novnc", "websockify", ["--web=/usr/share/novnc", "0.0.0.0:6080", "127.0.0.1:5900"]),
  service("cdp-proxy", "socat", [
    "TCP-LISTEN:9222,bind=0.0.0.0,reuseaddr,fork",
    `TCP:127.0.0.1:${chromiumCdpPort}`,
  ]),
  service(
    "chromium",
    chromium.executablePath(),
    [
      `--user-data-dir=${profilePath}`,
      `--window-size=${config.width},${config.height}`,
      "--remote-debugging-address=0.0.0.0",
      `--remote-debugging-port=${chromiumCdpPort}`,
      "--remote-allow-origins=*",
      "--disable-setuid-sandbox",
      "--no-first-run",
      "--no-default-browser-check",
      "--password-store=basic",
      "about:blank",
    ],
    { DISPLAY: display, HOME: "/home/pwuser", XDG_RUNTIME_DIR: "/tmp/anvia-browser-runtime" },
  ),
);

let shuttingDown = false;
const keepAlive = setInterval(() => {}, 60_000);
const shutdown = async (exitCode) => {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(keepAlive);
  for (const { child } of services) child.kill("SIGTERM");
  await Promise.all(services.map(({ child }) => waitForExit(child, 5_000)));
  process.exit(exitCode);
};

process.once("SIGTERM", () => {
  writeSync(2, "Browser service supervisor received SIGTERM.\n");
  void shutdown(0);
});
process.once("SIGINT", () => {
  writeSync(2, "Browser service supervisor received SIGINT.\n");
  void shutdown(0);
});
for (const { name, child } of services) {
  child.once("exit", (code, signal) => {
    if (!shuttingDown) {
      writeSync(
        2,
        `Browser service exited: name=${name} pid=${child.pid} code=${code} signal=${signal}\n`,
      );
      void shutdown(code === 0 ? 1 : (code ?? 1));
    }
  });
}

await new Promise(() => {});

function start(command, args, env = {}) {
  return spawn(command, args, {
    env: { ...process.env, ...env },
    stdio: "inherit",
  });
}

function service(name, command, args, env = {}) {
  return { name, child: start(command, args, env) };
}

async function readConfiguration() {
  let value;
  try {
    value = JSON.parse(await readFile(configPath, "utf8"));
  } catch (error) {
    throw new Error("Browser is not configured. Run anvia-browser-configure first.", {
      cause: error,
    });
  }
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !Number.isSafeInteger(value.width) ||
    !Number.isSafeInteger(value.height) ||
    typeof value.passwordPath !== "string"
  ) {
    throw new TypeError("Stored browser configuration is invalid.");
  }
  return value;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    delay(timeoutMs).then(() => child.kill("SIGKILL")),
  ]);
}
