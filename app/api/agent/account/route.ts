import { NextResponse, type NextRequest } from "next/server";
import { makeAgentCode } from "@/lib/connect/agents";
import { accountFor, passwordUser } from "@/lib/business/agent-auth";
import { call, failure, noStore, PublicError, serverDb } from "@/lib/business/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Agent sign-in and applications. An applicant gets nothing until the CEO approves them. */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const db = serverDb();
  if (!db) return NextResponse.json({ error: "Please try again soon." }, { status: 503, headers: noStore });
  const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");
  const email = text(body?.email, 254).toLowerCase(); const password = typeof body?.password === "string" ? body.password.slice(0, 200) : "";
  if (!EMAIL.test(email) || password.length < 6) return NextResponse.json({ error: "Enter your email and a password of at least 6 characters." }, { status: 400, headers: noStore });
  try {
    if (body?.mode === "apply") {
      if (typeof body.website === "string" && body.website) throw new PublicError("Please try again.");
      const name = text(body.name, 60); const phone = text(body.phone, 20); const city = text(body.city, 60);
      if (name.length < 2 || phone.length < 7 || city.length < 2) throw new PublicError("Add your name, phone number and city.");
      const userId = await accountFor(email, password, name);
      if (!userId) throw new PublicError("That email already has an account. Use its password, or sign in instead.");
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try { const result = await call<{ status: string }>(db, "agent_apply", { p_user: userId, p_code: makeAgentCode(name), p_name: name, p_phone: phone, p_city: city }); return NextResponse.json(result, { headers: noStore }); }
        catch (error) { if (error instanceof PublicError || attempt === 4) throw error; }
      }
    }
    const userId = await passwordUser(email, password);
    if (!userId) throw new PublicError("That email and password don't match.");
    const agent = await call<{ status: string; active: boolean; token: string | null } | null>(db, "agent_for_user", { p_user: userId });
    if (!agent) throw new PublicError("This account isn't an agent yet. Apply below.");
    if (agent.token) return NextResponse.json({ url: `/agent/${agent.token}` }, { headers: noStore });
    throw new PublicError(agent.status === "pending" ? "Your application is still being reviewed. We'll contact you soon." : "This agent account isn't active. Please contact TrustHub.");
  } catch (error) { return failure(error); }
}
