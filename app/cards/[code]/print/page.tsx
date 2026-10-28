import type { Metadata } from "next";
import styles from "./print.module.css";
import { createSupabaseServerClient } from "@/lib/supabase/server-client";
import { cardLinks, getLandingCard, normalizeCardCode } from "@/lib/connect/cards";
import { qrSvg } from "@/lib/connect/qr";
import type { ConnectDbClient } from "@/lib/connect/supabase-store";
import { headers } from "next/headers";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Print review card", robots: { index: false, follow: false } };

/** Front and back of a review card at true size (85.6 × 54 mm), ready to print. */
export default async function PrintCard({ params }: { params: Promise<{ code: string }> }) {
  const { code: raw } = await params;
  const code = normalizeCardCode(raw);
  const card = code ? await getLandingCard(createSupabaseServerClient() as unknown as ConnectDbClient, code).catch(() => null) : null;
  if (!card) return <main className={styles.sheet}><p>That card doesn&apos;t exist.</p></main>;
  const host = (await headers()).get("host");
  const base = process.env.PUBLIC_BASE_URL?.trim() || (host ? `https://${host}` : "");
  const qr = qrSvg(cardLinks(base, card.code).qr, { size: 300, dark: "#0f4f47" });

  return (
    <main className={styles.sheet}>
      <p className={styles.hint}>Print at 100% scale. Write the NFC link <code>{cardLinks(base, card.code).nfc}</code> to the chip.</p>
      <section className={`${styles.card} ${styles.front}`} aria-label="Card front">
        <div className={styles.brand}><span className={styles.mark}>T</span><span><b>TrustHub</b><small>Connect</small></span></div>
        <div className={styles.frontBody}>
          <div>
            <h1>How did we do?</h1>
            <p>Tap your phone here or scan to review <b>{card.business?.name ?? "this business"}</b> on WhatsApp.</p>
            <p className={styles.tap}>Takes 20 seconds · no app needed</p>
          </div>
          <div className={styles.qr} dangerouslySetInnerHTML={{ __html: qr }} />
        </div>
      </section>
      <section className={`${styles.card} ${styles.back}`} aria-label="Card back">
        <h2>How it works</h2>
        <ol>
          <li><b>Tap or scan</b><span>Hold your phone near the card, or scan the QR code.</span></li>
          <li><b>WhatsApp opens</b><span>Wisdom already knows which business you&apos;re at.</span></li>
          <li><b>Rate and earn</b><span>Your review counts as a verified visit, and you earn a free credit.</span></li>
        </ol>
        <div className={styles.backFoot}><span>Find trusted businesses on <b>TrustHub Connect</b></span><span className={styles.code}>Card {card.code}</span></div>
      </section>
    </main>
  );
}
