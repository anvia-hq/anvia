import { spawnSync } from "node:child_process";

const gitResult = spawnSync(
  "git",
  ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"],
  { encoding: "utf8" },
);

if (gitResult.status !== 0) {
  process.stderr.write(gitResult.stderr);
  process.exit(gitResult.status ?? 1);
}

const files = gitResult.stdout.split("\0").filter(Boolean);

if (files.length === 0) {
  console.log("No staged files to check.");
  process.exit(0);
}

const isWindows = process.platform === "win32";
const pnpm = isWindows ? "pnpm.cmd" : "pnpm";
const checks = [
  ["oxfmt", "--check", "--no-error-on-unmatched-pattern", "--", ...files],
  ["oxlint", "--no-error-on-unmatched-pattern", "--", ...files],
];

for (const args of checks) {
  const result = spawnSync(pnpm, ["exec", ...args], {
    stdio: "inherit",
    shell: isWindows,
  });

  if (result.error !== undefined) {
    process.stderr.write(`${result.error.message}\n`);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
