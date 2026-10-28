import { NextRequest, NextResponse } from "next/server";
import { adminPasswordLogin, adminPasswordReset, noStore } from "@/lib/admin/connect-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Email + password sign-in with TrustHub's own accounts; only admin_users members get a session. */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { email?: unknown; password?: unknown; reset?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase().slice(0, 254) : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: "Enter your email address." }, { status: 400, headers: noStore });
  if (body?.reset === true) {
    await adminPasswordReset(email);
    return NextResponse.json({ ok: true, message: "If that email has a TrustHub account, a reset link is on its way." }, { headers: noStore });
  }
  const password = typeof body?.password === "string" ? body.password.slice(0, 200) : "";
  if (!password) return NextResponse.json({ error: "Enter your password." }, { status: 400, headers: noStore });
  const result = await adminPasswordLogin(email, password);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status, headers: noStore });
  return NextResponse.json({ token: result.token, expiresAt: result.expiresAt }, { headers: noStore });
}
