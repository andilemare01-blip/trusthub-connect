#!/usr/bin/env node
/**
 * Corpus expansion CLI.
 *
 * Usage (run from the repo root):
 *   node --experimental-strip-types scripts/corpus-add.mts check <batch.json>
 *   node --experimental-strip-types scripts/corpus-add.mts add <batch.json> [--apply]
 *   node --experimental-strip-types scripts/corpus-add.mts report
 *
 * The CLI is intentionally dependency-free (Node stdlib only) so it can run
 * before any server configuration exists. It does not call any external API
 * and never modifies files unless `--apply` is passed.
 */
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadCorpus } from "../lib/understanding/corpus-loader.ts";
import { validateBatchFile, checkBatchConflicts, formatBatchReport } from "../lib/understanding/corpus-batch.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function usage() {
  console.log([
    "corpus-add.mts — incremental understanding-corpus expansion",
    "",
    "  node --experimental-strip-types scripts/corpus-add.mts check <batch.json>",
    "  node --experimental-strip-types scripts/corpus-add.mts add <batch.json> [--apply]",
    "  node --experimental-strip-types scripts/corpus-add.mts report",
    "",
    "Exit codes: 0 = ok, 1 = validation/conflict failure, 2 = usage error.",
  ].join("\n"));
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || ["-h", "--help"].includes(args[0])) { usage(); process.exit(2); }
  const command = args[0];

  if (command === "report") {
    const result = loadCorpus(repoRoot);
    if (result.problems.length) {
      console.log(`Corpus load FAILED: ${result.problems.length} problem(s).`);
      for (const p of result.problems) console.log(`  - [${p.field}] ${p.id}: ${p.message}`);
      process.exit(1);
    }
    if (!result.valid) {
      console.log(`Corpus is INVALID: ${result.summary.duplicatePhraseCount} duplicate-phrase pair(s), 0 structural problems.`);
      for (const p of result.summary.leakageRiskPairs) console.log(`  - ${p.a} <-> ${p.b}: ${p.reason}`);
      process.exit(1);
    }
    console.log(`Corpus: ${result.examples.length} examples, ${result.summary.validated} validated.`);
    console.log(`By intent: ${JSON.stringify(result.summary.byIntent)}`);
    console.log(`By provenance: ${JSON.stringify(result.summary.byProvenance)}`);
    console.log(`By language: ${JSON.stringify(result.summary.byLanguage)}`);
    console.log(`Duplicate phrases: ${result.summary.duplicatePhraseCount}`);
    return;
  }

  const batchPath = args[1];
  if (!batchPath) { usage(); process.exit(2); }
  const apply = args.includes("--apply");

  const batch = validateBatchFile(batchPath);
  const existing = loadCorpus(repoRoot);
  const conflicts = checkBatchConflicts(batch, existing.examples, (id) => existing.sourceFileById.get(id) ?? "<unknown>");
  console.log(formatBatchReport(batch, conflicts));

  if (!batch.valid) { console.log("\nBatch is invalid; nothing was written."); process.exit(1); }
  if (conflicts.hasConflicts) {
    console.log("\nBatch conflicts with the existing corpus; resolve them before applying.");
    process.exit(1);
  }
  if (!apply) {
    console.log("\nValidation passed. Re-run with --apply to merge.");
    return;
  }

  // Merge: append the batch as a new seed file next to the existing seeds.
  const targetDir = path.join(repoRoot, "corpus");
  if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });
  const base = path.basename(batchPath).replace(/\.json$/, "");
  const target = path.join(targetDir, `${base}.json`);
  if (existsSync(target)) {
    console.log(`\nRefusing to overwrite existing seed: ${target}`);
    process.exit(1);
  }
  writeFileSync(target, JSON.stringify(batch.examples, null, 2) + "\n", "utf8");
  console.log(`\nMerged ${batch.examples.length} example(s) into ${target}.`);
  console.log("Run `npm test` and `npm run build` to verify the corpus did not regress runtime behavior.");
}

main();