/**
 * Loads and validates the version-controlled understanding corpus from disk.
 *
 * The corpus lives under `corpus/` as JSON. `loadCorpus` reads every
 * `*.json` file in the corpus root, merges the examples, validates each one,
 * and rejects any corpus that fails validation. It never silently drops
 * invalid examples — callers must handle the problems explicitly.
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import type { UnderstandingExample } from "./corpus-schema.ts";
import { validateCorpus, type ValidationProblem } from "./corpus-validator.ts";

const CORPUS_DIR = path.join("corpus");

export interface CorpusLoadResult {
  examples: UnderstandingExample[];
  /** Maps each example id to the seed file it was loaded from, for conflict reporting. */
  sourceFileById: Map<string, string>;
  problems: ValidationProblem[];
  summary: ReturnType<typeof validateCorpus>["summary"];
  valid: boolean;
}

export function loadCorpus(root: string = process.cwd()): CorpusLoadResult {
  const dir = path.join(root, CORPUS_DIR);
  const examples: UnderstandingExample[] = [];
  const sourceFileById = new Map<string, string>();

  if (!existsSync(dir)) {
    return { examples, sourceFileById, problems: [{ id: "<corpus>", field: "path", message: `corpus directory not found: ${dir}` }], summary: emptySummary(), valid: false };
  }

  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => path.join(dir, f))
    .filter((f) => statSync(f).isFile());

  for (const file of files) {
    let raw: string;
    try { raw = readFileSync(file, "utf8"); } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { examples, sourceFileById, problems: [{ id: path.basename(file), field: "path", message: `failed to read ${file}: ${message}` }], summary: emptySummary(), valid: false };
    }
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { examples, sourceFileById, problems: [{ id: path.basename(file), field: "path", message: `invalid JSON in ${file}: ${message}` }], summary: emptySummary(), valid: false };
    }
    const list = Array.isArray(parsed) ? parsed : (parsed as { examples?: unknown }).examples;
    if (!Array.isArray(list)) {
      return { examples, sourceFileById, problems: [{ id: path.basename(file), field: "path", message: `${file} must export a JSON array or { examples: [...] }` }], summary: emptySummary(), valid: false };
    }
    for (const item of list) {
      const example = item as UnderstandingExample;
      examples.push(example);
      if (example.id) sourceFileById.set(example.id, path.basename(file));
    }
  }

  const { problems, duplicates, summary } = validateCorpus(examples);
  const valid = problems.length === 0 && duplicates.length === 0;
  return { examples, sourceFileById, problems, summary: { ...summary, duplicatePhraseCount: duplicates.length }, valid };
}

function emptySummary(): ReturnType<typeof validateCorpus>["summary"] {
  return { total: 0, validated: 0, byIntent: {}, byLanguage: {}, byProvenance: {}, duplicatePhraseCount: 0, leakageRiskPairs: [] };
}

/** Number of examples that passed validation (status "validated"). */
export function validatedCount(examples: UnderstandingExample[]): number {
  return examples.filter((ex) => ex.validation === "validated").length;
}

/** Count of examples by intent, restricted to validated examples. */
export function intentDistribution(examples: UnderstandingExample[]): Record<string, number> {
  const dist: Record<string, number> = {};
  for (const ex of examples) {
    if (ex.validation !== "validated") continue;
    dist[ex.intent] = (dist[ex.intent] ?? 0) + 1;
  }
  return dist;
}
