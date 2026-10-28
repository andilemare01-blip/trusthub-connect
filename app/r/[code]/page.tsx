import type { Metadata } from "next";
import { headers } from "next/headers";
import styles from "./landing.module.css";
import { createSupabaseServerClient } from "@/lib/supabase/server-client";
import { getLandingCard, normalizeCardCode, recordCardTap } from "@/lib/connect/cards";
import type { ConnectDbClient } from "@/lib/connect/supabase-store";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Review on TrustHub",
  description: "Tap to review this business on TrustHub Connect.",
  robots: { index: false, follow: false },
};

interface LandingProps {
  params: Promise<{ code: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** The TrustHub Connect WhatsApp number people message, digits only (e.g. 263771234567). */
function whatsappNumber(): string | null {
  const digits = (process.env.TRUSTHUB_WHATSAPP_NUMBER ?? "").replace(/\D/g, "");
  return digits.length >= 8 ? digits : null;
}

export default async function CardLanding({ params, searchParams }: LandingProps) {
  const { code: rawCode } = await params;
  const query = await searchParams;
  const code = normalizeCardCode(rawCode);
  const db = createSupabaseServerClient() as unknown as ConnectDbClient;
  const card = code ? await getLandingCard(db, code).catch(() => null) : null;
  const number = whatsappNumber();

  if (card && card.status === "active" && card.business) {
    const source = query.s === "nfc" ? "nfc" : query.s === "qr" ? "qr" : "link";
    const userAgent = (await headers()).get("user-agent");
    // A failed count must never stop someone from reviewing.
    await recordCardTap(db, card.code, source, userAgent).catch(() => undefined);
  }

  if (!card || card.status !== "active" || !card.business) {
    return (
      <main className={styles.page}>
        <header className={styles.top}><Brand /></header>
        <section className={styles.card}>
          <p className={styles.kicker}>Review card</p>
          <h1 className={styles.name}>This card isn&apos;t active</h1>
          <p className={styles.meta}>It may have been paused or moved. You can still find and review businesses on TrustHub Connect.</p>
        </section>
        {number ? <div className={styles.actions}><a className={styles.primary} href={`https://wa.me/${number}?text=${encodeURIComponent("Hi")}`}>Open TrustHub on WhatsApp</a></div> : null}
      </main>
    );
  }

  const business = card.business;
  const place = [business.area, business.city].filter(Boolean).join(", ");
  const whatsappHref = number ? `https://wa.me/${number}?text=${encodeURIComponent(`REVIEW ${card.code}`)}` : null;

  return (
    <main className={styles.page}>
      <header className={styles.top}><Brand /></header>
      <section className={styles.card}>
        <p className={styles.kicker}>You&apos;re at</p>
        <h1 className={styles.name}>{business.name}</h1>
        <p className={styles.meta}>{[business.category, place].filter(Boolean).join(" · ")}</p>
        {business.reviewsCount > 0 ? <p className={styles.count}>{business.reviewsCount} {business.reviewsCount === 1 ? "review" : "reviews"} on TrustHub</p> : null}
      </section>
      <section className={styles.body}>
        <h2 className={styles.question}>How was your visit?</h2>
        <p className={styles.lead}>It takes about 20 seconds. Your review helps others find businesses they can trust.</p>
        <div className={styles.actions}>
          {whatsappHref ? (
            <a className={styles.primary} href={whatsappHref}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true"><path d="M4 20l1.3-4A8 8 0 1 1 8 18.7z" /></svg>
              Review on WhatsApp
            </a>
          ) : (
            <p className={styles.lead}>WhatsApp reviews are being set up. Please try again soon.</p>
          )}
        </div>
      </section>
      <footer className={styles.footer}>
        <span className={styles.badge}>Reviews from this card count as verified visits</span>
        <span className={styles.small}>Card {card.code} · No sign-up needed</span>
      </footer>
    </main>
  );
}

function Brand() {
  return (
    <div className={styles.brand}>
      <span className={styles.mark} aria-hidden="true">T</span>
      <span className={styles.word}>TrustHub</span>
    </div>
  );
}
