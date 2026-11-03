/** What TrustHub sells to businesses, and when it is the right moment to mention it. No I/O: shared by the server and tests. */

export const TOKEN_COST = { report: 10, market: 3, reply: 1, ask: 1, post: 1 } as const;

export const OWNER_PRODUCTS = ["tokens_small", "tokens_large"] as const;
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

export type Trade = "food" | "beauty" | "stay" | "retail" | "health" | "trades" | "general";

export function tradeOf(category: string | null | undefined): Trade {
  const text = (category ?? "").toLowerCase();
  if (/food|dining|restaurant|cafe|takeaway|bakery|butcher|bar\b/.test(text)) return "food";
  if (/salon|beauty|barber|hair|spa|nail/.test(text)) return "beauty";
  if (/accommodation|lodge|hotel|guest|tourism/.test(text)) return "stay";
  if (/grocer|retail|shop|hardware|supermarket|clothing|boutique/.test(text)) return "retail";
  if (/health|clinic|pharmacy|dental|doctor|education|school/.test(text)) return "health";
  if (/construction|engineering|motoring|plumb|electric|mechanic|repair|services/.test(text)) return "trades";
  return "general";
}

export interface ProductOffer { key: string; name: string; from: number; hook: string; helps: string; question: string }

const HOOKS: Record<string, Partial<Record<Trade, [string, string]>> & { general: [string, string] }> = {
  menu: {
    general: ["Tired of sending your price list 20 times a day?", "A QR code on your wall or WhatsApp status opens your latest prices. Change a price once and it's right everywhere."],
    food: ["Reprinting menus every time prices change?", "Customers scan a QR code on the table and see today's menu. Change a price in a minute, with no reprinting."],
    beauty: ["Clients always asking what a style costs?", "A QR price list shows every service and price, so clients can choose before they sit down."],
    stay: ["Guests calling just to ask your rates?", "One QR code shows your rooms, rates and meal times, day or night."],
  },
  maps: {
    general: ["Your best customer can't remember your number.", "We set you up on Google Maps with your hours and directions, so people can find you and call you in one tap."],
    trades: ["Someone's geyser just burst. Can they find you?", "When people search nearby in a hurry, your name, number and directions are right there."],
  },
  flyers: {
    general: ["Got a special nobody knows about?", "Clean designs for your specials, ready to print or post on WhatsApp status and Facebook."],
    food: ["Is Friday your quiet day?", "Designs for your lunch deals and weekend specials, ready for your WhatsApp status."],
  },
  website: {
    general: ["Your customers are looking for you at midnight. Are you there?", "A fresh website with a strong domain works for you all day, showing who you are, what people say about you, and one tap to reach you."],
    stay: ["Are travellers finding you, or only the booking sites?", "Your own site shows your rooms and reviews, and guests can reach you directly."],
    trades: ["Do people trust a number they found on a pole?", "A real website with your work and reviews shows you're a proper business."],
  },
  booking: {
    general: ["Losing orders while you're busy?", "Customers fill in a short form and the order or booking lands on your WhatsApp, ready to confirm."],
    food: ["Phone ringing all through the lunch rush?", "Customers order ahead from their phones, and you get it on WhatsApp."],
    beauty: ["Clients double-booked again?", "Clients pick a time on their phone, and you confirm it on WhatsApp."],
  },
  catalog: {
    general: ["Sending photos of stock one by one?", "All your products, photos and prices on one page, with a WhatsApp order button on each."],
    retail: ["Customers asking 'do you have this?' all day?", "Your whole shop on one page. Customers see what you stock and order on WhatsApp."],
  },
  loyalty: {
    general: ["Want customers to come back, not just come once?", "'Buy 5, get 1 free', tracked with a QR code instead of paper cards that get lost."],
    beauty: ["Clients drifting to the salon down the road?", "A digital loyalty card gives them a reason to keep coming back to you."],
    food: ["Regulars deserve a reason to stay regular.", "'Your 6th plate is free', tracked with a QR code."],
  },
  whatsapp: {
    general: ["Answering the same WhatsApp questions all night?", "Automatic replies on your own number for prices, hours and directions, handing over to you when it matters."],
  },
};
const PRODUCTS: { key: string; name: string; from: number }[] = [
  { key: "menu", name: "Digital menu or price list", from: 10 }, { key: "maps", name: "Google Maps setup", from: 10 }, { key: "flyers", name: "Flyers and social media posts", from: 10 },
  { key: "website", name: "Website", from: 30 }, { key: "booking", name: "Booking or order form", from: 20 }, { key: "catalog", name: "Online catalog", from: 40 },
  { key: "loyalty", name: "Digital loyalty card", from: 15 }, { key: "whatsapp", name: "WhatsApp automation", from: 50 },
];
const FIRST: Record<Trade, string[]> = {
  food: ["menu", "booking", "loyalty", "website"], beauty: ["booking", "menu", "loyalty", "website"], stay: ["website", "menu", "maps", "booking"], retail: ["catalog", "maps", "flyers", "website"],
  health: ["maps", "website", "booking", "menu"], trades: ["maps", "website", "flyers", "whatsapp"], general: ["website", "maps", "menu", "flyers"],
};

/** Every product, most useful for this trade first, in words that fit the trade. */
export function offersFor(category: string | null | undefined): ProductOffer[] {
  const trade = tradeOf(category);
  const order = [...FIRST[trade], ...PRODUCTS.map((item) => item.key).filter((key) => !FIRST[trade].includes(key))];
  return order.map((key) => {
    const item = PRODUCTS.find((product) => product.key === key)!;
    const [hook, helps] = HOOKS[key][trade] ?? HOOKS[key].general;
    return { ...item, hook, helps, question: `How could a ${item.name.toLowerCase()} help my business? Be specific to my reviews, my trade and my town.` };
  });
}

/** Reviews about money, safety or the law always go to a person, never to an automatic reply. */
export function needsOwner(comment: string): boolean {
  return /scam|fraud|con ?artist|refund|money back|charged twice|stole|steal|theft|thief|police|court|lawyer|unsafe|danger|assault|attack|poison|food ?poison|sick|injur|harass|mbavha/i.test(comment);
}

export type AutoMode = "post" | "draft" | "flag";
/** 4 and 5 stars can post by themselves. Anything lower waits for the owner. */
export function autoMode(rating: number, comment: string): AutoMode {
  if (needsOwner(comment)) return "flag";
  return rating >= 4 ? "post" : "draft";
}

export interface TodayRate { key: string; value: number; previous: number | null }
/** A short free line for the day, built from real changes. It never guesses at the future. */
export function dailyTake(rates: TodayRate[], missed: number, category: string | null, day: number): string {
  const fuel = rates.find((rate) => rate.key === "fuel.diesel");
  const usd = rates.find((rate) => rate.key === "fx.usd_zwg");
  if (fuel?.previous && fuel.value !== fuel.previous) return `Diesel moved from $${fuel.previous} to $${fuel.value} a litre. If you deliver or transport stock, check your prices still cover it.`;
  if (missed > 0) return `${missed} ${missed === 1 ? "person" : "people"} searched for ${category || "your kind of business"} near you and found nothing. Make sure your page is complete so the next one finds you.`;
  if (usd?.previous && Math.abs(usd.value - usd.previous) / usd.previous >= 0.005) return `The official ZiG rate moved to ${usd.value} per US dollar. If you price in ZiG, it's worth checking today.`;
  const tips = ["Answer one old review today. People read replies as much as reviews.", "Ask your next happy customer to scan your review card before they leave.", "Post one special on your WhatsApp status today. It's free and your regulars will see it.", "Check your opening hours on TrustHub are right. Wrong hours lose customers quietly."];
  return tips[day % tips.length];
}
