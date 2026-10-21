import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const revision = "fa00ccdc13dfaa4b288a91877c1f3e468af4aa7d";
const args = process.argv.slice(2).filter((arg) => arg !== "--");
if (args.length < 1 || args.length > 2) {
  throw new Error("Usage: pnpm test:tck <clean acp-tck checkout> [summary.json]");
}
const checkout = resolve(args[0]);
const packageRoot = fileURLToPath(new URL("..", import.meta.url));
function capture(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 60_000 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr}`);
  return result.stdout.trim();
}
if (
  capture("git", ["-C", checkout, "rev-parse", "HEAD"]) !== revision ||
  capture("git", ["-C", checkout, "status", "--porcelain"]) !== ""
) {
  throw new Error(`Use a clean ACP TCK checkout at ${revision}; see test/CONFORMANCE.md.`);
}
const scratch = await mkdtemp(join(tmpdir(), "anvia-acp-tck-"));
const summaryPath = resolve(args[1] ?? join(tmpdir(), "anvia-acp-tck-summary.json"));
try {
  const rawPath = join(scratch, "raw.json");
  const uvArgs = ["run", "--project", checkout, "--frozen"];
  const python = capture("uv", [...uvArgs, "python", "--version"]);
  const run = spawnSync(
    "uv",
    [
      ...uvArgs,
      "acp-tck",
      "--protocol-version",
      "1",
      "--agent-cwd",
      scratch,
      "--timeout",
      "5",
      "--test-timeout",
      "30",
      "--cancel-prompt",
      "fixture:wait",
      "--report-json",
      rawPath,
      "--",
      process.execPath,
      join(packageRoot, "dist/cli.js"),
      join(packageRoot, "test/fixtures/conformance-agent.mjs"),
    ],
    { stdio: "inherit", timeout: 180_000 },
  );
  if (run.error) throw run.error;
  const report = JSON.parse(await readFile(rawPath, "utf8"));
  const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
  // Keep reproducible verdicts and skip reasons, never record traffic or stderr payloads.
  const summary = {
    tck_repository: "https://github.com/agentclientprotocol/acp-tck",
    tck_revision: revision,
    tck_version: report.tck_version,
    protocol_version: report.protocol_version,
    schema_revision: report.schema_revision,
    sdk_version: manifest.dependencies["@agentclientprotocol/sdk"],
    environment: { platform: process.platform, arch: process.arch, node: process.version, python },
    fixture: "test/fixtures/conformance-agent.mjs via dist/cli.js",
    cancel_prompt: "fixture:wait",
    started_at: report.started_at,
    finished_at: report.finished_at,
    verdict: report.verdict,
    requirements: report.requirements.map(({ id, tier, status, tests }) => ({
      id,
      tier,
      status,
      tests: tests.map(({ nodeid, status, message }) => {
        const result = { nodeid, status };
        if (message)
          result.message = message
            .replaceAll(checkout, "<acp-tck>")
            .replaceAll(scratch, "<scratch>");
        return result;
      }),
    })),
  };
  await writeFile(summaryPath, JSON.stringify(summary, null, 2) + "\n");
  console.log(`ACP TCK summary: ${summaryPath}`);
  // Strengthen the upstream verdict: required cancellations must actually be exercised.
  const mandatoryPassed = summary.requirements
    .filter((entry) => entry.tier === "MANDATORY")
    .every((entry) => entry.status === "PASS");
  process.exitCode = run.status === 0 && report.verdict.conformant && mandatoryPassed ? 0 : 1;
} finally {
  await rm(scratch, { recursive: true, force: true });
}
