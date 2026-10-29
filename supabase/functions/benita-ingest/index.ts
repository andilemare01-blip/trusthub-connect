/**
 * Benita ingest: the collector behind TrustHub Connect.
 *
 * POST { action: "probe", url }                 look at a page, save nothing
 * POST { action: "osm", key, tile }             OpenStreetMap places, one tag key per tile
 * POST { action: "web", source }                one crawl batch for a configured website
 * POST { action: "facts" }                      fuel ceilings and the official exchange rate
 * POST { action: "sync" }                       mirror new records into businesses
 * POST { action: "tick" }                       scheduler: run whatever is due
 *
 * Long actions answer 202 at once and keep working; progress is written to
 * knowledge_ingestion_jobs. Callers authenticate with the x-benita-secret header.
 */
import { finishJob, rest, rpc, startJob } from "./db.ts";
import { KEYS, runOsm, TILES } from "./osm.ts";
import { probe, runWeb } from "./web.ts";
import { runFacts } from "./facts.ts";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let cachedSecret: string | null = null;

/** The shared secret lives in benita_settings (no RLS policies), so pg_cron and this function read the same value. */
async function authorised(req: Request): Promise<boolean> {
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (bearer && bearer === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) return true;
  const given = req.headers.get("x-benita-secret");
  if (!given) return false;
  if (!cachedSecret) {
    const rows = await rest<{ value: string }[]>("benita_settings?key=eq.cron_secret&select=value");
    cachedSecret = rows[0]?.value ?? Deno.env.get("BENITA_CRON_SECRET") ?? null;
  }
  return !!cachedSecret && given.length === cachedSecret.length && given === cachedSecret;
}

/** Runs a job in the background and records its outcome. */
function background(sourceKey: string, scope: Record<string, unknown>, work: () => Promise<{ seen: number; accepted: number; rejected: number }>): Promise<string> {
  return startJob(sourceKey, scope).then((jobId) => {
    const task = (async () => {
      try {
        const result = await work();
        await finishJob(jobId, result);
      } catch (error) {
        await finishJob(jobId, { seen: 0, accepted: 0, rejected: 0, error: String(error) });
      }
    })();
    if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(task);
    return jobId;
  });
}

async function syncAfter<T>(result: T): Promise<T> {
  await rpc("benita_sync_businesses", { p_since: new Date(Date.now() - 3 * 3_600_000).toISOString() });
  return result;
}

/** Picks the web source that has waited longest, plus facts once a day. */
async function tick(): Promise<{ seen: number; accepted: number; rejected: number }> {
  const totals = { seen: 0, accepted: 0, rejected: 0 };
  const due = await rest<{ source_key: string }[]>("knowledge_sources?benita_enabled=eq.true&source_type=neq.osm&select=source_key&order=benita_last_run_at.asc.nullsfirst&limit=1");
  for (const row of due) {
    const result = await runWeb(row.source_key, 95_000);
    totals.seen += result.seen; totals.accepted += result.accepted; totals.rejected += result.rejected;
  }
  const facts = await rest<{ retrieved_at: string }[]>("benita_facts?select=retrieved_at&order=retrieved_at.desc&limit=1");
  if (!facts.length || Date.now() - Date.parse(facts[0].retrieved_at) > 20 * 3_600_000) {
    const result = await runFacts();
    totals.seen += result.seen; totals.accepted += result.accepted;
  }
  return await syncAfter(totals);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  if (!(await authorised(req))) return json({ error: "unauthorised" }, 401);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "JSON body required" }, 400); }
  try {
    switch (body.action) {
      case "probe":
        return json(await probe(String(body.url)));
      case "osm": {
        const key = String(body.key ?? "all"), tile = String(body.tile);
        if ((key !== "all" && !KEYS[key]) || !TILES[tile]) return json({ error: "key or tile unknown", keys: ["all", ...Object.keys(KEYS)], tiles: Object.keys(TILES) }, 400);
        return json({ job: await background("osm", { key, tile }, () => runOsm(key, tile).then(syncAfter)) }, 202);
      }
      case "web": {
        const key = String(body.source);
        return json({ job: await background(key, { batch: true }, () => runWeb(key).then(syncAfter)) }, 202);
      }
      case "facts":
        return json({ job: await background("benita_facts", {}, () => runFacts()) }, 202);
      case "sync":
        return json(await rpc("benita_sync_businesses", { p_since: body.since ?? new Date(0).toISOString() }));
      case "tick":
        return json({ job: await background("benita_tick", {}, tick) }, 202);
      default:
        return json({ error: "unknown action" }, 400);
    }
  } catch (error) {
    return json({ error: String(error).slice(0, 500) }, 500);
  }
});
