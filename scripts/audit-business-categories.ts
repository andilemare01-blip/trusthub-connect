/**
 * Read-only audit of business category quality against the live Supabase project.
 * Usage: npm run audit:categories [-- --out report.json]
 * Needs SUPABASE_URL and SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) in the environment or .env.local.
 * It only issues SELECT queries. It never inserts, updates or deletes, and it prints no credentials.
 */
import { writeFileSync } from "node:fs";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { auditBusinessCategories, type AuditBusiness } from "../lib/discovery/category-audit.ts";

config({ path: ".env.local", quiet: true });
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("SUPABASE_URL and SUPABASE_SECRET_KEY are required for the category audit.");
  process.exit(2);
}

const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const PAGE = 1000;

async function readAll(): Promise<AuditBusiness[]> {
  const rows: AuditBusiness[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client.from("businesses").select("id,name,category,subcategory").order("id", { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw new Error(`businesses read failed: ${error.message}`);
    for (const row of data ?? []) rows.push({ id: String(row.id), name: typeof row.name === "string" ? row.name : null, category: typeof row.category === "string" ? row.category : null, subcategory: typeof row.subcategory === "string" ? row.subcategory : null });
    if (!data || data.length < PAGE) return rows;
  }
}

const report = auditBusinessCategories(await readAll());
const outIndex = process.argv.indexOf("--out");
if (outIndex > -1 && process.argv[outIndex + 1]) writeFileSync(process.argv[outIndex + 1], JSON.stringify(report, null, 2));

const byConcept = (items: { label: string }[]) => Object.entries(items.reduce<Record<string, number>>((counts, item) => ({ ...counts, [item.label]: (counts[item.label] ?? 0) + 1 }), {})).sort((left, right) => right[1] - left[1]).slice(0, 15);
console.log(JSON.stringify({
  total: report.total, missingCategory: report.missingCategory, blankCategory: report.blankCategory, missingSubcategory: report.missingSubcategory, missingBoth: report.missingBoth,
  distinctCategories: report.distinctCategories, genericCategories: report.genericCategories.slice(0, 15),
  casingVariantGroups: report.casingVariants.length, casingVariantSamples: report.casingVariants.slice(0, 10),
  namingGroups: report.namingGroups.slice(0, 15),
  highConfidenceSuggestions: report.highConfidence.length, highConfidenceByService: byConcept(report.highConfidence), highConfidenceSamples: report.highConfidence.slice(0, 15).map(({ id, name, label, matchedTerm }) => ({ id, name, label, matchedTerm })),
  uncertainCandidates: report.uncertain.length, uncertainByService: byConcept(report.uncertain), uncertainSamples: report.uncertain.slice(0, 15).map(({ id, name, label, matchedTerm, alternatives }) => ({ id, name, label, matchedTerm, alternatives })),
  insufficientInformation: report.insufficient.count, limits: report.limits,
}, null, 2));
