/**
 * Minimal PostgREST client for Benita. Runs with the service role inside the
 * edge function, so it never leaves the server.
 */
const URL = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const BASE_HEADERS = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

export async function rest<T = unknown>(path: string, init: RequestInit & { prefer?: string } = {}): Promise<T> {
  const headers: Record<string, string> = { ...BASE_HEADERS, ...(init.headers as Record<string, string> ?? {}) };
  if (init.prefer) headers.Prefer = init.prefer;
  const response = await fetch(`${URL}/rest/v1/${path}`, { ...init, headers });
  const text = await response.text();
  if (!response.ok) throw new Error(`db ${response.status} ${path.split("?")[0]}: ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : null) as T;
}

export async function rpc<T = unknown>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  return await rest<T>(`rpc/${name}`, { method: "POST", body: JSON.stringify(args) });
}

/** Inserts or merges rows in chunks, returning how many were sent. */
export async function upsert(table: string, rows: Record<string, unknown>[], onConflict: string, chunk = 400): Promise<number> {
  let sent = 0;
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk);
    await rest(`${table}?on_conflict=${onConflict}`, { method: "POST", body: JSON.stringify(slice), prefer: "resolution=merge-duplicates,return=minimal" });
    sent += slice.length;
  }
  return sent;
}

export interface SourceRow {
  id: string;
  source_key: string;
  name: string;
  license: string | null;
  reuse_status: string;
  benita_enabled: boolean;
  benita_config: Record<string, unknown>;
}

export async function source(key: string): Promise<SourceRow> {
  const rows = await rest<SourceRow[]>(`knowledge_sources?source_key=eq.${encodeURIComponent(key)}&select=id,source_key,name,license,reuse_status,benita_enabled,benita_config`);
  if (!rows.length) throw new Error(`unknown source ${key}`);
  return rows[0];
}

export async function startJob(sourceKey: string, scope: Record<string, unknown>): Promise<string> {
  const rows = await rest<{ id: string }[]>("knowledge_ingestion_jobs", {
    method: "POST", prefer: "return=representation",
    body: JSON.stringify({ source_key: sourceKey, scope, status: "running", started_at: new Date().toISOString() }),
  });
  return rows[0].id;
}

export async function finishJob(id: string, result: { seen: number; accepted: number; rejected: number; error?: string | null }): Promise<void> {
  await rest(`knowledge_ingestion_jobs?id=eq.${id}`, {
    method: "PATCH", prefer: "return=minimal",
    body: JSON.stringify({
      status: result.error ? "failed" : "completed", records_seen: result.seen, records_accepted: result.accepted,
      records_rejected: result.rejected, error_message: result.error?.slice(0, 500) ?? null, completed_at: new Date().toISOString(),
    }),
  });
}
