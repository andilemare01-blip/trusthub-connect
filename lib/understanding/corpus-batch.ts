/**
 * Incremental corpus batch operations.
 *
 * A batch is a JSON file (or array of example objects) that is validated
 * against the active corpus without rewriting it. This module is the
 * acceptance gate: nothing it validates is admitted to the loader unless
 * every rule passes, and nothing is silently dropped.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { UnderstandingExample } from "./corpus-schema.ts";
import { validateCorpus, type ValidationProblem } from "./corpus-validator.ts";

export interface BatchValidationResult {
  file: string;
  examples: UnderstandingExample[];
  problems: ValidationProblem[];
  duplicatesWithinBatch: Array<{ a: string; b: string; similarity: number }>;
  valid: boolean;
}

/** Validate a single batch file in isolation (does not touch the corpus dir). */
export function validateBatchFile(batchPath: string): BatchValidationResult {
  const absolute = path.resolve(batchPath);
  if (!existsSync(absolute)) {
    return { file: batchPath, examples: [], problems: [{ id: "<batch>", field: "path", message: `batch file not found: ${absolute}` }], duplicatesWithinBatch: [], valid: false };
  }
  let raw: string;
  try { raw = readFileSync(absolute, "utf8"); } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { file: batchPath, examples: [], problems: [{ id: "<batch>", field: "path", message: `failed to read ${absolute}: ${message}` }], duplicatesWithinBatch: [], valid: false };
  }
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { file: batchPath, examples: [], problems: [{ id: "<batch>", field: "path", message: `invalid JSON in ${absolute}: ${message}` }], duplicatesWithinBatch: [], valid: false };
  }
  const list = Array.isArray(parsed) ? parsed : (parsed as { examples?: unknown }).examples;
  if (!Array.isArray(list)) {
    return { file: batchPath, examples: [], problems: [{ id: "<batch>", field: "path", message: `${absolute} must export a JSON array or { examples: [...] }` }], duplicatesWithinBatch: [], valid: false };
  }
  const examples = list as UnderstandingExample[];
  const { problems, duplicates } = validateCorpus(examples);
  // Map the validator's example pairs to id/similarity rows so the report
  // contract stays readable (no [object Object]) and consistent with the
  // conflict-report shape used elsewhere in this module.
  const duplicatesWithinBatch = duplicates.map((d) => ({ a: d.a.id, b: d.b.id, similarity: d.similarity }));
  return { file: batchPath, examples, problems, duplicatesWithinBatch, valid: problems.length === 0 && duplicatesWithinBatch.length === 0 };
}

/** Compare a candidate batch against the already-loaded corpus and report
 * conflicts (duplicate phrases, duplicate IDs) without modifying anything. */
export interface BatchConflictReport {
  batchFile: string;
  newExampleCount: number;
  duplicateIds: Array<{ id: string; existingFile: string; batchFile: string }>;
  duplicatePhrases: Array<{ a: string; b: string; similarity: number; reason: string }>;
  hasConflicts: boolean;
}

export function checkBatchConflicts(
  batch: BatchValidationResult,
  existing: UnderstandingExample[],
  existingFileForId: (id: string) => string,
): BatchConflictReport {
  const duplicateIds: BatchConflictReport["duplicateIds"] = [];
  const duplicatePhrases: BatchConflictReport["duplicatePhrases"] = [];
  const existingIds = new Set(existing.map((ex) => ex.id));
  for (const ex of batch.examples) {
    if (existingIds.has(ex.id)) {
      duplicateIds.push({ id: ex.id, existingFile: existingFileForId(ex.id), batchFile: batch.file });
    }
  }
  // Reuse the validator's near-duplicate detector across batch + existing.
  const combined = [...existing, ...batch.examples];
  const { duplicates } = validateCorpus(combined);
  // Filter to only pairs where at least one side is from the batch.
  const batchIds = new Set(batch.examples.map((ex) => ex.id));
  for (const d of duplicates) {
    if (batchIds.has(d.a.id) || batchIds.has(d.b.id)) {
      duplicatePhrases.push({ a: d.a.id, b: d.b.id, similarity: d.similarity, reason: `near-duplicate phrase (similarity ${(d.similarity * 100).toFixed(1)}%)` });
    }
  }
  return { batchFile: batch.file, newExampleCount: batch.examples.length, duplicateIds, duplicatePhrases, hasConflicts: duplicateIds.length > 0 || duplicatePhrases.length > 0 };
}

/** Render a human-readable validation report for console output. */
export function formatBatchReport(result: BatchValidationResult, conflicts?: BatchConflictReport): string {
  const lines: string[] = [];
  lines.push(`Batch: ${result.file}`);
  lines.push(`Examples: ${result.examples.length}`);
  lines.push(`Valid: ${result.valid ? "yes" : "no"}`);
  if (result.problems.length) {
    lines.push("Problems:");
    for (const p of result.problems) lines.push(`  - [${p.field}] ${p.id}: ${p.message}`);
  }
  if (result.duplicatesWithinBatch.length) {
    lines.push("Duplicates within batch:");
    for (const d of result.duplicatesWithinBatch) lines.push(`  - ${d.a} <-> ${d.b} (${(d.similarity * 100).toFixed(1)}%)`);
  }
  if (conflicts) {
    lines.push(`Conflicts with existing corpus: ${conflicts.hasConflicts ? "yes" : "no"}`);
    lines.push(`New examples: ${conflicts.newExampleCount}`);
    for (const d of conflicts.duplicateIds) lines.push(`  - duplicate id ${d.id} already in ${d.existingFile}`);
    for (const d of conflicts.duplicatePhrases) lines.push(`  - near-duplicate phrase ${d.a} <-> ${d.b} (${(d.similarity * 100).toFixed(1)}%)`);
  }
  return lines.join("\n");
}