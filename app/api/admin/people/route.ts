import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin, noStore } from "@/lib/admin/connect-admin";

export const dynamic = "force-dynamic";

/** The founder's view: headline numbers and everyone who has used Connect, most recently active first. */
export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (admin instanceof NextResponse) return admin;
  const rpc = admin.db.rpc;
  if (!rpc) return NextResponse.json({ error: "People data is unavailable." }, { status: 503, headers: noStore });
  const [numbers, people] = await Promise.all([
    rpc.call(admin.db, "connect_founder_numbers", {}),
    rpc.call(admin.db, "connect_people", { p_limit: 200 }),
  ]);
  if (numbers.error || people.error) return NextResponse.json({ error: "People data could not be loaded." }, { status: 500, headers: noStore });
  return NextResponse.json({ numbers: numbers.data, people: people.data }, { headers: noStore });
}
