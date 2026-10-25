#!/usr/bin/env node
/**
 * Corpus expansion CLI.
 *
 * Usage:
 *   node scripts/corpus-add.mjs add <batch.json> [--corpus-dir ./corpus]
 *     Validate a candidate batch against the active corpus, report conflicts,
 *     and (with --apply) merge it into the corpus directory.
 *
 *   node scripts/corpus-add.mjs check <batch.json>
 *     Validate only; never writes.
 *
 *   node scripts/corpus-add.mjs report
 *     Print a summary of the currently loaded corpus.
 *
 * The CLI is intentionally dependency-free (Node stdlib only) so it can run
 * before any server configuration exists. It does not call any external API.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function loadModules() {
  // Modules use .ts extensions and are run via the same experimental strip
  // flag as the test suite; load them through a dynamic import of the
  // compiled-by-node ESM path by re-exporting from a tiny shim.
  return import(path.join(repoRoot, "scripts", "_corpus-cli.mjs"));
}

function usage() {
  console.log([
    "corpus-add.mjs — incremental understanding-corpus expansion",
    "",
    "  node scripts/corpus-add.mjs add <batch.json> [--apply]",
    "  node scripts/corpus-add.mjs check <batch.json>",
    "  node scripts/corpus-add.mjs report",
    "",
    "Exit codes: 0 = ok, 1 = validation/conflict failure, 2 = usage error.",
  ].join("\n"));
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || ["-h", "--help"].includes(args[0])) { usage(); process.exit(2); }
  const { validateBatchFile, checkBatchConflicts, formatBatchReport, loadCorpusForCli } = await loadModules();
  const command = args[0];

  if (command === "report") {
    const result = loadCorpusForCli();
    if (!result.valid) {
      console.log(`Corpus is INVALID: ${result.problems.length} problem(s).`);
      for (const p of result.problems) console.log(`  - [${p.field}] ${p.id}: ${p.message}`);
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
  const existing = loadCorpusForCli();
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

main().catch((error) => { console.error(error); process.exit(2); });