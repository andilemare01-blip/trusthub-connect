import { NextRequest, NextResponse } from "next/server";
import { normalizeCardCode, cardLinks } from "@/lib/connect/cards";
import { qrSvg } from "@/lib/connect/qr";

export const runtime = "nodejs";

/**
 * The QR code for a card, as an SVG. A card's link is public by design (it is
 * printed on the card), so this needs no sign-in. ?download=1 saves it as a file.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ code: string }> }) {
  const { code: raw } = await context.params;
  const code = normalizeCardCode(raw);
  if (!code) return NextResponse.json({ error: "Unknown card." }, { status: 404 });
  const base = process.env.PUBLIC_BASE_URL?.trim() || request.nextUrl.origin;
  const svg = qrSvg(cardLinks(base, code).qr, { size: 512, dark: "#0f4f47" });
  return new NextResponse(svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
      ...(request.nextUrl.searchParams.get("download") ? { "Content-Disposition": `attachment; filename="${code}-qr.svg"` } : {}),
    },
  });
}
