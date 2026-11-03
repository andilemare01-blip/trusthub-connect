import { NextResponse, type NextRequest } from "next/server";
import { call, failure, noStore, requireOwner } from "@/lib/business/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { dailyTake, nextOffer, offersFor, whatsappLink, type TodayRate } from "@/lib/business/catalog";

type Context = { tokens: number; payments: unknown[]; open_deal: string | null; has_website: boolean; bought_website: boolean; website_from: string; ceo_whatsapp: string | null; reviews: number; unanswered: number; category: string | null; searches_30: number; report_run: boolean };

/** Everything the owner's screen adds on top of the dashboard: tokens, payments, and the one thing worth suggesting today. */
export async function GET(request: NextRequest) {
  const owner = await requireOwner(request, request.nextUrl.searchParams.get("business"));
  if (owner instanceof NextResponse) return owner;
  try {
    const context = await call<Context>(owner.db, "biz_owner_context", { p_business: owner.businessId });
    const offer = nextOffer({ hasWebsite: context.has_website, boughtWebsite: context.bought_website, openDeal: !!context.open_deal, reviews: context.reviews, unanswered: context.unanswered, searches30: context.searches_30, category: context.category, tokens: context.tokens, websiteFrom: context.website_from }, context.report_run);
    const [today, ai] = await Promise.all([
      call<{ rates: TodayRate[]; missed: number; category: string | null }>(owner.db, "biz_today", { p_business: owner.businessId }),
      call(owner.db, "biz_ai_get", { p_business: owner.businessId }),
    ]);
    return NextResponse.json({
      today: { ...today, take: dailyTake(today.rates, today.missed, today.category, new Date().getDate()) }, ai, offers: offersFor(context.category),
      tokens: context.tokens, payments: context.payments, openDeal: context.open_deal ? `/deal/${context.open_deal}` : null, websiteFrom: context.website_from,
      hasWebsite: context.has_website, boughtWebsite: context.bought_website, offer,
      whatsapp: whatsappLink(context.ceo_whatsapp, "Hi, I'm interested in the TrustHub Digital Package."),
    }, { headers: noStore });
  } catch (error) { return failure(error); }
}
