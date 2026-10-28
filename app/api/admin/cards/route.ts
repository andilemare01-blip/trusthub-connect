import { NextRequest, NextResponse } from "next/server";
import { noStore, requireAdmin } from "@/lib/admin/connect-admin";
import { cardLinks, createCard, listCards, updateCard } from "@/lib/connect/cards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Card links always point at the production site, never at the preview the admin happens to be using. */
function baseUrl(request: NextRequest): string {
  return process.env.PUBLIC_BASE_URL?.trim() || request.nextUrl.origin;
}

function failure(error: unknown, fallback: string) {
  const message = error instanceof Error && /^(Choose|That business|Unknown)/.test(error.message) ? error.message : fallback;
  return NextResponse.json({ error: message }, { status: message === fallback ? 500 : 400, headers: noStore });
}

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (admin instanceof NextResponse) return admin;
  try {
    const cards = await listCards(admin.db);
    const base = baseUrl(request);
    return NextResponse.json({ cards: cards.map((card) => ({ ...card, links: cardLinks(base, card.code) })) }, { headers: noStore });
  } catch (error) { return failure(error, "The cards could not be loaded."); }
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (admin instanceof NextResponse) return admin;
  const body = await request.json().catch(() => null) as { businessId?: unknown; note?: unknown } | null;
  try {
    const card = await createCard(admin.db, typeof body?.businessId === "string" ? body.businessId : "", admin.userId, typeof body?.note === "string" ? body.note : null);
    return NextResponse.json({ card: { ...card, links: cardLinks(baseUrl(request), card.code) } }, { headers: noStore });
  } catch (error) { return failure(error, "The card could not be created."); }
}

export async function PATCH(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (admin instanceof NextResponse) return admin;
  const body = await request.json().catch(() => null) as { id?: unknown; status?: unknown; businessId?: unknown } | null;
  try {
    await updateCard(admin.db, typeof body?.id === "string" ? body.id : "", {
      ...(body?.status === "active" || body?.status === "paused" || body?.status === "unassigned" ? { status: body.status } : {}),
      ...(typeof body?.businessId === "string" || body?.businessId === null ? { businessId: body.businessId as string | null } : {}),
    });
    return NextResponse.json({ ok: true }, { headers: noStore });
  } catch (error) { return failure(error, "The card could not be updated."); }
}
