import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { startApiServer } from "./server";

const apiPort = await findOpenPort(Number(process.env.API_PORT ?? 8787));
const webPort = await findOpenPort(Number(process.env.WEB_PORT ?? 5177));
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

const apiServer = startApiServer(apiPort);
const vite = spawn(pnpm, ["exec", "vite", "--host", "127.0.0.1", "--port", String(webPort)], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    API_PORT: String(apiPort),
    WEB_PORT: String(webPort),
  },
  stdio: "inherit",
});

let closing = false;

function close(exitCode = 0): void {
  if (closing) {
    return;
  }
  closing = true;
  vite.kill("SIGTERM");
  apiServer.close(() => {
    process.exit(exitCode);
  });
}

vite.on("exit", (code) => {
  close(code ?? 0);
});

process.on("SIGINT", () => {
  close(0);
});

process.on("SIGTERM", () => {
  close(0);
});

function findOpenPort(startPort: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();

    server.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") {
        resolve(findOpenPort(startPort + 1));
        return;
      }
      reject(error);
    });

    server.once("listening", () => {
      server.close(() => {
        resolve(startPort);
      });
    });

    server.listen(startPort, "127.0.0.1");
  });
}
