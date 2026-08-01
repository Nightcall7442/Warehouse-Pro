#!/usr/bin/env node
/**
 * FIX: P1.5 — ratchet gate for the type and lint backlog.
 *
 * The repository carries a large pre-existing backlog (see quality-baseline.json),
 * so a plain `tsc && eslint` gate would fail every build and get switched off
 * within a week. This compares the current count against a recorded baseline:
 *
 *   more errors than the baseline  → fail, the change made it worse
 *   fewer errors than the baseline → pass, and print the new number to record
 *
 * Lower the numbers in quality-baseline.json as they come down; never raise them
 * without saying why in the commit message.
 *
 * Usage: node scripts/quality-gate.mjs [typecheck|lint|all]
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const baseline = JSON.parse(readFileSync(join(root, "quality-baseline.json"), "utf8"));

/** Run a command, returning stdout even when it exits non-zero (both tools do). */
function run(cmd, args) {
  try {
    return execFileSync(cmd, args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    if (typeof err.stdout === "string") return err.stdout + (err.stderr ?? "");
    throw err;
  }
}

/**
 * Unique `file(line,col): error TSxxxx` lines. `tsc -b` reports an error once per
 * referencing project, so the raw line count double-counts; de-duplicating keeps
 * the number stable and comparable between runs.
 */
function countTypeErrors() {
  const output = run("npx", ["tsc", "-b", "--force"]);
  const errors = new Set(
    output.split("\n").filter(line => /error TS\d+/.test(line)).map(line => line.trim()),
  );
  return errors.size;
}

function countLintErrors() {
  const output = run("npx", ["eslint", ".", "-f", "json"]);
  const start = output.indexOf("[");
  if (start === -1) throw new Error(`eslint produced no JSON report:\n${output.slice(0, 2000)}`);
  const report = JSON.parse(output.slice(start));
  return report.reduce((sum, file) => sum + file.errorCount, 0);
}

const checks = {
  typecheck: { label: "TypeScript errors", count: countTypeErrors, baseline: baseline.typecheckErrors },
  lint: { label: "ESLint errors", count: countLintErrors, baseline: baseline.lintErrors },
};

const requested = process.argv[2] ?? "all";
const names = requested === "all" ? Object.keys(checks) : [requested];
if (names.some(name => !checks[name])) {
  console.error(`Unknown check "${requested}". Use: ${Object.keys(checks).join(", ")}, all`);
  process.exit(2);
}

let failed = false;
for (const name of names) {
  const { label, count, baseline: allowed } = checks[name];
  const actual = count();

  if (actual > allowed) {
    console.error(`✗ ${label}: ${actual} (baseline ${allowed}) — this change added ${actual - allowed}`);
    failed = true;
  } else if (actual < allowed) {
    console.log(`✓ ${label}: ${actual} (baseline ${allowed}) — ${allowed - actual} fewer, lower the baseline to ${actual}`);
  } else {
    console.log(`✓ ${label}: ${actual}, unchanged from the baseline`);
  }
}

process.exit(failed ? 1 : 0);
