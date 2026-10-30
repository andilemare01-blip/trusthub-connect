import { NextRequest, NextResponse } from "next/server";
import { adminSetPassword, noStore } from "@/lib/admin/connect-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Finishes a password reset: the reset email's one-time token plus the new password. */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { accessToken?: unknown; password?: unknown } | null;
  const accessToken = typeof body?.accessToken === "string" ? body.accessToken.slice(0, 4000) : "";
  const password = typeof body?.password === "string" ? body.password.slice(0, 200) : "";
  if (!accessToken) return NextResponse.json({ error: "This reset link is incomplete. Ask for a new one from the sign-in page." }, { status: 400, headers: noStore });
  if (password.length < 8) return NextResponse.json({ error: "Use at least 8 characters." }, { status: 400, headers: noStore });
  const result = await adminSetPassword(accessToken, password);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status, headers: noStore });
  return NextResponse.json({ ok: true }, { headers: noStore });
}
