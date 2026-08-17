import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const stateDirectory = "/home/pwuser/.anvia-browser";
const configPath = `${stateDirectory}/config.json`;
const passwordDirectory = "/home/pwuser/.vnc";
const passwordPath = `${passwordDirectory}/passwd`;

const input = await readStandardInput();
let value;
try {
  value = JSON.parse(input);
} catch (error) {
  throw new TypeError("Browser configuration must be valid JSON.", { cause: error });
}

if (typeof value !== "object" || value === null || Array.isArray(value)) {
  throw new TypeError("Browser configuration must be an object.");
}
if (typeof value.password !== "string" || !/^[\x20-\x7e]{8}$/.test(value.password)) {
  throw new TypeError("Browser VNC password must contain exactly 8 printable ASCII characters.");
}
assertDimension(value.width, "width", 640, 3840);
assertDimension(value.height, "height", 480, 2160);

await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
await mkdir(passwordDirectory, { recursive: true, mode: 0o700 });
await storeVncPassword(value.password);
await writeFile(
  configPath,
  `${JSON.stringify({ width: value.width, height: value.height, passwordPath })}\n`,
  { encoding: "utf8", mode: 0o600 },
);

async function storeVncPassword(password) {
  await new Promise((resolve, reject) => {
    const child = spawn("x11vnc", ["-storepasswd"], {
      env: { ...process.env, HOME: "/home/pwuser" },
      stdio: ["pipe", "ignore", "pipe"],
    });
    const errors = [];
    child.stderr.on("data", (chunk) => errors.push(Buffer.from(chunk)));
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`x11vnc password configuration failed with exit code ${code}.`));
    });
    child.stdin.end(`${password}\n${password}\ny\n`);
  });
  const stored = await readFile(passwordPath);
  if (stored.byteLength === 0) throw new Error("x11vnc created an empty password file.");
}

function assertDimension(value, name, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be an integer between ${min} and ${max}.`);
  }
}

async function readStandardInput() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}
