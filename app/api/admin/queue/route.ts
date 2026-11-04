import { NextRequest, NextResponse } from "next/server";
import { approveAll, decide, noStore, readQueue, requireAdmin, type QueueKind } from "@/lib/admin/connect-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Approving every listing at once takes about 30 seconds.
export const maxDuration = 60;

const KINDS: readonly QueueKind[] = ["reviews", "listings", "businesses", "scams"];
const kindOf = (value: unknown): QueueKind | null => (KINDS as readonly unknown[]).includes(value) ? value as QueueKind : null;

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (admin instanceof NextResponse) return admin;
  const kind = kindOf(request.nextUrl.searchParams.get("kind"));
  if (!kind) return NextResponse.json({ error: "Unknown list." }, { status: 400, headers: noStore });
  try {
    return NextResponse.json({ items: await readQueue(admin.db, kind) }, { headers: noStore });
  } catch {
    return NextResponse.json({ error: "The list could not be loaded." }, { status: 500, headers: noStore });
  }
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (admin instanceof NextResponse) return admin;
  const body = await request.json().catch(() => null) as { kind?: unknown; id?: unknown; decision?: unknown; all?: unknown } | null;
  const kind = kindOf(body?.kind);
  if (kind && kind !== "scams" && body?.all === true) {
    try {
      return NextResponse.json({ approved: await approveAll(admin.db, kind) }, { headers: noStore });
    } catch {
      return NextResponse.json({ error: "Those changes could not be saved." }, { status: 500, headers: noStore });
    }
  }
  if (!kind || typeof body?.id !== "string" || (body.decision !== "approve" && body.decision !== "reject")) return NextResponse.json({ error: "Unknown decision." }, { status: 400, headers: noStore });
  try {
    await decide(admin.db, kind, body.id, body.decision === "approve");
    return NextResponse.json({ ok: true }, { headers: noStore });
  } catch {
    return NextResponse.json({ error: "That change could not be saved." }, { status: 500, headers: noStore });
  }
}
