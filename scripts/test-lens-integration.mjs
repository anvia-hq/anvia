import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lensRoot = resolve(process.env.ANVIA_LENS_REPO ?? resolve(root, "../lens"));
const options = new Set(process.argv.slice(2));
const environment = {
  ...loadEnvironment(await readFile(resolve(root, ".env"), "utf8")),
  ...process.env,
};

for (const name of [
  "ANVIA_LENS_BASE_URL",
  "ANVIA_LENS_PUBLIC_KEY",
  "ANVIA_LENS_SECRET_KEY",
  "ANVIA_LENS_SERVICE_NAME",
]) {
  if (!environment[name]) throw new Error(`${name} is required in .env or the process environment`);
}
if (!/^[A-Za-z0-9_-]+$/.test(environment.ANVIA_LENS_PUBLIC_KEY)) {
  throw new Error("ANVIA_LENS_PUBLIC_KEY contains unsupported characters");
}

const publicKey = sqlLiteral(environment.ANVIA_LENS_PUBLIC_KEY);

if (options.has("--rebuild")) {
  run("docker", ["compose", "up", "-d", "--build"], { cwd: lensRoot });
} else {
  run("docker", ["compose", "up", "-d"], { cwd: lensRoot });
}
await waitForReady();
const localApiBaseUrl = composeServiceUrl("api", 3001);

const projectId = compose([
  "exec",
  "-T",
  "postgres",
  "psql",
  "-U",
  "lens",
  "-d",
  "lens",
  "-Atc",
  `SELECT project_id FROM project_api_keys WHERE public_key = ${publicKey} AND revoked_at IS NULL LIMIT 1`,
]).trim();
if (!/^[0-9a-f-]{36}$/.test(projectId)) {
  throw new Error("The configured public key does not resolve to an active Lens project");
}
const projectIdLiteral = sqlLiteral(projectId);

const smoke = run("pnpm", ["--filter", "cookbook", "integrations:08"], {
  cwd: root,
  env: {
    ...environment,
    ANVIA_LENS_BASE_URL: localApiBaseUrl,
  },
  capture: true,
});
const payload = parseSmokeOutput(smoke);
const traceId = payload.trace?.traceId;
const observationId = payload.trace?.observationId;
const runId = payload.runId;
if (!/^[0-9a-f]{32}$/.test(traceId ?? "") || !/^[0-9a-f]{16}$/.test(observationId ?? "")) {
  throw new Error("The native smoke example did not return valid trace correlation identifiers");
}
if (typeof runId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(runId)) {
  throw new Error("The native smoke example did not return an evaluation run ID");
}
const traceIdLiteral = sqlLiteral(traceId);
const runIdLiteral = sqlLiteral(runId);
if (payload.outcome !== "pass")
  throw new Error(`Expected a passing evaluation, got ${payload.outcome}`);

await waitFor(async () => {
  const [traces, evaluations, runs] = clickhouse(
    `SELECT
      (SELECT count() FROM trace_summaries FINAL
        WHERE project_id=${projectIdLiteral} AND trace_id=${traceIdLiteral}),
      (SELECT count() FROM evaluation_results FINAL
        WHERE project_id=${projectIdLiteral} AND trace_id=${traceIdLiteral} AND run_id=${runIdLiteral}),
      (SELECT count() FROM evaluation_runs FINAL
        WHERE project_id=${projectIdLiteral} AND id=${runIdLiteral} AND status='completed')
      FORMAT TabSeparatedRaw`,
  )
    .trim()
    .split("\t")
    .map(Number);
  return traces === 1 && evaluations === 1 && runs === 1;
}, "trace, evaluation, and run ingestion");

const evaluation = JSON.parse(
  clickhouse(
    `SELECT run_id, trace_id, observation_id, suite_name, case_id, metric_name, outcome,
      service_name, environment, release, payload, payload_status
      FROM evaluation_results FINAL
      WHERE project_id=${projectIdLiteral} AND trace_id=${traceIdLiteral}
      ORDER BY timestamp DESC LIMIT 1
      FORMAT JSONEachRow`,
  ).trim(),
);
if (evaluation.observation_id !== observationId) {
  throw new Error("The evaluation was not correlated with the expected observation");
}
if (evaluation.run_id !== runId) throw new Error("The evaluation was not grouped into its run");
if (evaluation.metric_name !== "refund-policy-correctness" || evaluation.outcome !== "pass") {
  throw new Error("The stored evaluation metric or outcome is incorrect");
}
if (evaluation.payload_status !== "captured" || typeof evaluation.payload !== "string") {
  throw new Error("The opt-in evaluation payload was not captured");
}
const evaluationPayload = JSON.parse(evaluation.payload);
if (
  evaluationPayload.input !== "How long are refunds available?" ||
  evaluationPayload.expected !== "30 days" ||
  evaluationPayload.output === undefined
) {
  throw new Error("The stored evaluation payload is incomplete or incorrect");
}

const capturedPayloads = Number(
  clickhouse(
    `SELECT countIf(input IS NOT NULL OR output IS NOT NULL) FROM spans FINAL WHERE project_id=${projectIdLiteral} AND trace_id=${traceIdLiteral} FORMAT TabSeparatedRaw`,
  ).trim(),
);
if (capturedPayloads !== 0) throw new Error("Safe capture exported an input or output payload");

if (options.has("--durability")) {
  compose(["restart", "clickhouse"]);
  await waitForReady();
  compose(["up", "-d", "clickhouse", "api", "worker"]);
  await waitForReady();
  await waitFor(
    async () =>
      Number(
        clickhouse(
          `SELECT count() FROM evaluation_results FINAL WHERE project_id=${projectIdLiteral} AND trace_id=${traceIdLiteral} FORMAT TabSeparatedRaw`,
        ).trim(),
      ) === 1,
    "evaluation durability after ClickHouse restart",
  );
}

console.log(
  JSON.stringify(
    {
      status: "passed",
      projectId,
      traceId,
      observationId,
      runId,
      evaluation: {
        suite: evaluation.suite_name,
        caseId: evaluation.case_id,
        metric: evaluation.metric_name,
        outcome: evaluation.outcome,
        payloadStatus: evaluation.payload_status,
      },
      safeCapture: true,
      durability: options.has("--durability") ? "verified" : "not requested",
    },
    null,
    2,
  ),
);

function compose(args) {
  return run("docker", ["compose", ...args], { cwd: lensRoot, capture: true });
}

function composeServiceUrl(service, port) {
  const address = compose(["port", service, String(port)])
    .trim()
    .split(/\r?\n/, 1)[0];
  const hostPort = address?.match(/:(\d+)$/)?.[1];
  if (hostPort === undefined) throw new Error(`Could not resolve the ${service} Compose port`);
  return `http://127.0.0.1:${hostPort}`;
}

function clickhouse(query) {
  return compose([
    "exec",
    "-T",
    "clickhouse",
    "clickhouse-client",
    "--database",
    "lens",
    "--query",
    query,
  ]);
}

function assertReady() {
  const result = compose([
    "exec",
    "-T",
    "api",
    "wget",
    "-qO-",
    "http://127.0.0.1:3001/health/ready",
  ]);
  if (JSON.parse(result).status !== "ready") throw new Error("Lens API is not ready");
}

async function waitForReady() {
  await waitFor(() => {
    assertReady();
    return true;
  }, "Lens API readiness");
}

function run(command, args, settings = {}) {
  const result = spawnSync(command, args, {
    cwd: settings.cwd,
    env: settings.env,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    stdio: settings.capture ? "pipe" : "inherit",
  });
  if (result.status !== 0) {
    const details = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(
      `${command} failed with exit code ${result.status}${details ? `:\n${details}` : ""}`,
    );
  }
  return result.stdout ?? "";
}

function parseSmokeOutput(output) {
  const start = output.indexOf("{");
  if (start < 0) throw new Error("The native smoke example did not print a JSON result");
  return JSON.parse(output.slice(start));
}

async function waitFor(check, label) {
  let lastError;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      if (await check()) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }
  throw new Error(`Timed out waiting for ${label}`, { cause: lastError });
}

/**
 * Escape a value for safe interpolation into a SQL string literal.
 *
 * Wraps the input in single quotes and doubles any internal single quotes
 * using the standard SQL escaping rule (`'` → `''`), so the result can be
 * embedded directly into a query without risk of breaking out of the literal.
 *
 * @param {string} value - The value to escape.
 * @returns {string} A safely-quoted SQL string literal (e.g. `'hello'`, `'it''s'`).
 * @throws {Error} If `value` is not a string.
 */
function sqlLiteral(value) {
  if (typeof value !== "string") {
    throw new Error("SQL literal must be a string");
  }
  return `'${value.replaceAll("'", "''")}'`;
}

function loadEnvironment(source) {
  return Object.fromEntries(
    source
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"))
      .map((line) => {
        const separator = line.indexOf("=");
        if (separator < 1) return [line, ""];
        const key = line.slice(0, separator).trim();
        const raw = line.slice(separator + 1).trim();
        const value =
          (raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))
            ? raw.slice(1, -1)
            : raw;
        return [key, value];
      }),
  );
}
