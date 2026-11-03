import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { createAdminServerClient } from "../admin/server-client";
import { noStore } from "../admin/connect-admin";
import type { ConnectDbClient } from "../connect/supabase-store";

export { noStore };
type Rpc = { rpc?: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }> };

/** A message written for the person using the app. Anything else stays on the server. */
export class PublicError extends Error {}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Calls a server-only database function. Messages we raise ourselves (P0001) are safe to show; others are not. */
export async function call<T = unknown>(db: ConnectDbClient, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const client = db as unknown as Rpc;
  if (!client.rpc) throw new Error("rpc unavailable");
  const result = await client.rpc(fn, args);
  if (result.error) {
    if (result.error.code === "P0001") throw new PublicError(result.error.message);
    throw new Error(`${fn} failed (${result.error.code ?? "unknown"})`);
  }
  return result.data as T;
}

export function failure(error: unknown, fallback = "That didn't work. Please try again.") {
  if (error instanceof PublicError) return NextResponse.json({ error: error.message }, { status: 400, headers: noStore });
  console.error("business api", error instanceof Error ? error.message : "unknown");
  return NextResponse.json({ error: fallback }, { status: 500, headers: noStore });
}

export function serverDb(): ConnectDbClient | null {
  return createAdminServerClient() as unknown as ConnectDbClient | null;
}

/** The signed-in user behind a Supabase access token, or null. */
export async function signedInUser(request: NextRequest): Promise<string | null> {
  const client = createAdminServerClient();
  const match = /^Bearer\s+(\S{20,4096})$/i.exec(request.headers.get("authorization")?.trim() ?? "");
  if (!client || !match) return null;
  try { const { data, error } = await client.auth.getUser(match[1]); return error ? null : data.user?.id ?? null; } catch { return null; }
}

/** Only a verified owner of this business, or the CEO, gets through. */
export async function requireOwner(request: NextRequest, businessId: unknown): Promise<{ db: ConnectDbClient; userId: string; businessId: string } | NextResponse> {
  const db = serverDb();
  if (!db) return NextResponse.json({ error: "The server is not configured." }, { status: 503, headers: noStore });
  const userId = await signedInUser(request);
  if (!userId) return NextResponse.json({ error: "Please sign in again." }, { status: 401, headers: noStore });
  if (typeof businessId !== "string" || !UUID.test(businessId)) return NextResponse.json({ error: "Choose a business." }, { status: 400, headers: noStore });
  const [owner, admin] = await Promise.all([
    db.from("business_owners").select("id").eq("business_id", businessId).eq("user_id", userId).limit(1) as unknown as PromiseLike<{ data: unknown[] | null }>,
    db.from("admin_users").select("user_id").eq("user_id", userId).limit(1) as unknown as PromiseLike<{ data: unknown[] | null }>,
  ]);
  if (!owner.data?.length && !admin.data?.length) return NextResponse.json({ error: "This is not your business." }, { status: 403, headers: noStore });
  return { db, userId, businessId };
}
