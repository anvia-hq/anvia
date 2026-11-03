#!/usr/bin/env node
/**
 * Verifies the durable review documents.
 *
 * Checks, without any dependency:
 *  - both review documents exist;
 *  - every required section is present;
 *  - every finding has the required fields;
 *  - every `path:line` citation resolves to an existing file with at least that many lines;
 *  - the review ends with the prioritized P0/P1/P2 plan.
 *
 * Usage: node scripts/check-durable-review.mjs [--help]
 * Exits 0 when everything passes, 1 otherwise.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const REVIEW = "docs/reviews/durable-review.md";
const PARITY = "docs/reviews/durable-agent-parity.md";

const documents = [
  {
    path: REVIEW,
    sections: [
      "## Executive summary",
      "## Method",
      "## Severity table",
      "## Findings",
      "## Prioritized plan",
    ],
    lastHeading: "## Prioritized plan",
  },
  {
    path: PARITY,
    sections: [
      "## Parity matrix — `AgentOptions`",
      "## Parity matrix — `AgentRunSettings` / `AgentInput`",
      "## Parity matrix — features",
      "## Phased design",
      "## Checkpoint boundaries",
      "## Features that should stay unsupported",
    ],
  },
];

const findingPattern = /^#### (DUR-[A-Z0-9-]+)[^\n]*$/gm;
const requiredFindingFields = [
  ["Evidence", /\*\*Evidence[:.]\*\*/],
  ["Impact", /\*\*Impact[:.]\*\*/],
  ["Root cause", /\*\*Root cause[:.]\*\*/],
  ["Options", /\*\*Options[:.]\*\*/],
  ["Recommendation", /\*\*Recommendation[:.]\*\*/],
  ["Effort/risk", /\*\*Effort\/risk[:.]\*\*/],
];
const citationPattern =
  /\b((?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.(?:ts|tsx|mts|mjs|js|json|md|yaml|yml)):(\d+)\b/g;

const problems = [];
const summary = { documents: 0, citations: 0, findings: 0, uniqueFiles: new Set() };

function fail(document, message) {
  problems.push(`${document}: ${message}`);
}

function lineCount(file) {
  const text = readFileSync(file, "utf8");
  if (text.length === 0) return 0;
  const lines = text.split("\n");
  return lines.at(-1) === "" ? lines.length - 1 : lines.length;
}

function checkDocument(entry) {
  const absolute = join(root, entry.path);
  if (!existsSync(absolute) || !statSync(absolute).isFile()) {
    fail(entry.path, "document is missing");
    return;
  }
  const text = readFileSync(absolute, "utf8");
  summary.documents += 1;

  for (const section of entry.sections) {
    if (!text.includes(section)) fail(entry.path, `missing required section: ${section}`);
  }

  if (entry.lastHeading !== undefined) {
    const headings = [...text.matchAll(/^## .+$/gm)].map((match) => match[0]);
    const last = headings.at(-1);
    if (last === undefined || !last.startsWith(entry.lastHeading)) {
      fail(
        entry.path,
        `the last section must be "${entry.lastHeading}" (found "${last ?? "none"}")`,
      );
    }
  }

  // Findings: each heading must carry the full finding contract.
  const matches = [...text.matchAll(findingPattern)];
  if (entry.path === REVIEW) {
    if (matches.length === 0) fail(entry.path, "no findings found (expected #### DUR-… headings)");
    for (let index = 0; index < matches.length; index += 1) {
      const match = matches[index];
      const start = match.index + match[0].length;
      const end = index + 1 < matches.length ? matches[index + 1].index : text.length;
      const body = text.slice(start, end);
      for (const [label, pattern] of requiredFindingFields) {
        if (!pattern.test(body)) fail(entry.path, `finding ${match[1]} is missing ${label}`);
      }
    }
    summary.findings += matches.length;
  }

  // Citations: path must exist and cover the cited line.
  const seen = new Set();
  for (const match of text.matchAll(citationPattern)) {
    const [, path, rawLine] = match;
    const key = `${path}:${rawLine}`;
    if (seen.has(key)) continue;
    seen.add(key);
    summary.citations += 1;
    const line = Number(rawLine);
    if (!Number.isSafeInteger(line) || line < 1) {
      fail(entry.path, `invalid citation line: ${key}`);
      continue;
    }
    const target = join(root, path);
    if (!existsSync(target) || !statSync(target).isFile()) {
      fail(entry.path, `citation points to a missing file: ${key}`);
      continue;
    }
    summary.uniqueFiles.add(path);
    const count = lineCount(target);
    if (line > count) {
      fail(
        entry.path,
        `citation ${key} is out of range: ${relative(root, target)} has ${count} lines`,
      );
    }
  }
}

function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log("Usage: node scripts/check-durable-review.mjs");
    console.log(
      "Exits nonzero unless both review documents and every path:line citation are valid.",
    );
    return 0;
  }

  for (const entry of documents) checkDocument(entry);

  if (problems.length > 0) {
    console.error(`check-durable-review: ${problems.length} problem(s)`);
    for (const problem of problems) console.error(`  - ${problem}`);
    return 1;
  }

  console.log(
    `check-durable-review: ok (${summary.documents} documents, ${summary.findings} findings, ` +
      `${summary.citations} citations across ${summary.uniqueFiles.size} files)`,
  );
  return 0;
}

process.exitCode = main();
