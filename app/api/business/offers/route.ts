import { NextResponse, type NextRequest } from "next/server";
import { offersFor } from "@/lib/business/catalog";

/** Public product list, in the words of a trade. Used by the sample dashboard too. */
export function GET(request: NextRequest) {
  return NextResponse.json({ offers: offersFor(request.nextUrl.searchParams.get("category")?.slice(0, 80)) });
}
