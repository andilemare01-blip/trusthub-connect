/** What TrustHub sells to businesses, and when it is the right moment to mention it. No I/O: shared by the server and tests. */

export const TOKEN_COST = { report: 10, reply: 1 } as const;

export const OWNER_PRODUCTS = ["tokens_small", "tokens_large", "growth", "pro"] as const;
export type OwnerProduct = (typeof OWNER_PRODUCTS)[number];
export const PRODUCT_LABEL: Record<string, string> = {
  website: "Website", tokens_small: "50 Benita tokens", tokens_large: "200 Benita tokens", growth: "Growth plan", pro: "Pro plan", other: "Other",
};

export function isOwnerProduct(value: unknown): value is OwnerProduct {
  return typeof value === "string" && (OWNER_PRODUCTS as readonly string[]).includes(value);
}

/** wa.me link to the Marketing Executive with the message already typed, or null until the number is set. */
export function whatsappLink(number: string | null | undefined, message: string): string | null {
  const digits = (number ?? "").replace(/\D/g, "");
  return digits.length >= 8 ? `https://wa.me/${digits}?text=${encodeURIComponent(message)}` : null;
}

export interface OfferFacts {
  hasWebsite: boolean;
  boughtWebsite: boolean;
  openDeal: boolean;
  reviews: number;
  unanswered: number;
  searches30: number;
  category: string | null;
  tokens: number;
  websiteFrom: string;
}
export type Offer = { key: string; title: string; body: string; action: "deal" | "tokens" | "chat" | "reviews" | "benita"; cta: string };

/**
 * One suggestion at a time, chosen from what is true for this business today. Help comes first: an unanswered
 * review or an unused free report beats any sale, because value is what earns the sale. Every number shown is
 * real, and nothing here invents urgency or promises results.
 */
export function nextOffer(facts: OfferFacts, reportRun: boolean): Offer | null {
  if (facts.openDeal) return { key: "deal-open", title: "Your website chat is open", body: "Your agent and our Marketing Executive are in the chat. Pick up where you left off.", action: "chat", cta: "Open chat" };
  if (facts.unanswered > 0) return { key: "reply-first", title: `${facts.unanswered} customer${facts.unanswered === 1 ? " is" : "s are"} waiting for a reply`, body: "Replying is free, and people trust businesses that answer.", action: "reviews", cta: "Reply now" };
  if (!reportRun && facts.tokens >= TOKEN_COST.report) return { key: "first-report", title: "Benita has a report ready to write for you", body: `It's on us. Tips and ideas for your business, using ${TOKEN_COST.report} of your ${facts.tokens} tokens.`, action: "benita", cta: "Get my report" };
  const site = !facts.hasWebsite && !facts.boughtWebsite;
  if (site && facts.reviews >= 3) return { key: "site-reviews", title: `${facts.reviews} people have reviewed you. Where do the next ones find you?`, body: `Turn those reviews into a website with your own domain, from $${facts.websiteFrom}.`, action: "deal", cta: "Chat with an agent" };
  if (site && facts.searches30 > 0) return { key: "site-demand", title: `${facts.searches30} ${facts.searches30 === 1 ? "search" : "searches"} for ${facts.category || "your kind of business"} near you in 30 days`, body: `A website gives those people somewhere to land, from $${facts.websiteFrom}.`, action: "deal", cta: "Chat with an agent" };
  if (facts.tokens < TOKEN_COST.report && reportRun) return { key: "tokens-low", title: `You have ${facts.tokens} Benita token${facts.tokens === 1 ? "" : "s"} left`, body: `Your next report costs ${TOKEN_COST.report}. Packs start at $5.`, action: "tokens", cta: "See packs" };
  if (site) return { key: "site-general", title: "Get your business its own website", body: `A fresh website with a strong domain, from $${facts.websiteFrom}. Tell us what you need.`, action: "deal", cta: "See what's included" };
  return null;
}
