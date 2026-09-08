// Runs smoke.mjs + every feature*.mjs spec with bounded concurrency,
// instead of one at a time. Safe to parallelize because each spec already
// gets its own throwaway SQLite file (harness.mjs's freshTestDbDir/seedFixture)
// and, since harness.mjs picks a fresh OS-assigned port per launchApp() call
// instead of a hardcoded one, its own tauri-driver instance too — no two
// concurrent specs share any state.
//
// Usage:
//   node e2e/run-all.mjs                 # default concurrency (4)
//   node e2e/run-all.mjs --concurrency=8
//   node e2e/run-all.mjs --concurrency=1  # effectively the old sequential behavior

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const e2eDir = path.dirname(fileURLToPath(import.meta.url));

const concurrencyArg = process.argv.find((a) => a.startsWith("--concurrency="));
const concurrency = concurrencyArg ? Number(concurrencyArg.split("=")[1]) : 4;
if (!Number.isInteger(concurrency) || concurrency < 1) {
  console.error(`--concurrency must be a positive integer, got "${concurrencyArg}"`);
  process.exit(1);
}

const specs = ["smoke.mjs", ...fs.readdirSync(e2eDir).filter((f) => /^feature\d+.*\.mjs$/.test(f)).sort(
  (a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]),
)];

function runSpec(name) {
  return new Promise((resolve) => {
    const start = Date.now();
    const child = spawn(process.execPath, [path.join(e2eDir, name)], { cwd: path.resolve(e2eDir, ".."), stdio: "pipe" });
    let output = "";
    child.stdout.on("data", (d) => (output += d.toString()));
    child.stderr.on("data", (d) => (output += d.toString()));
    child.on("close", (code) => {
      resolve({ name, code, output, durationMs: Date.now() - start });
    });
  });
}

// A small fixed-size worker pool: `concurrency` specs in flight at once,
// each starting the next spec off the shared queue as soon as it finishes
// — simpler than a generic promise-pool dependency for a queue this small.
async function runAll(names, limit) {
  const results = [];
  let next = 0;
  async function worker() {
    while (next < names.length) {
      const name = names[next++];
      console.log(`start  ${name}`);
      const result = await runSpec(name);
      console.log(`${result.code === 0 ? "PASS  " : "FAIL  "} ${name} (${(result.durationMs / 1000).toFixed(1)}s)`);
      results.push(result);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, names.length) }, worker));
  return results;
}

const overallStart = Date.now();
console.log(`Running ${specs.length} specs with concurrency ${concurrency}...\n`);
const results = await runAll(specs, concurrency);
const totalSeconds = ((Date.now() - overallStart) / 1000).toFixed(1);

const failed = results.filter((r) => r.code !== 0);
console.log(`\n${results.length - failed.length}/${results.length} passed in ${totalSeconds}s (concurrency ${concurrency})`);
if (failed.length > 0) {
  console.log("\nFAILURES:");
  for (const f of failed) {
    console.log(`\n=== ${f.name} (exit ${f.code}) ===`);
    console.log(f.output);
  }
  process.exit(1);
}
