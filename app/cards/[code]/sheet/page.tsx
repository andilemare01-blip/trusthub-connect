import type { Metadata } from "next";
import { headers } from "next/headers";
import styles from "./sheet.module.css";
import { createSupabaseServerClient } from "@/lib/supabase/server-client";
import { cardLinks, getLandingCard, normalizeCardCode } from "@/lib/connect/cards";
import { qrSvg } from "@/lib/connect/qr";
import type { ConnectDbClient } from "@/lib/connect/supabase-store";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Printable review sheet", robots: { index: false, follow: false } };

/** Eight free review slips on one A4 page, for photocopying and cutting up. Each scans to the same review link. */
export default async function ReviewSheet({ params }: { params: Promise<{ code: string }> }) {
  const { code: raw } = await params;
  const code = normalizeCardCode(raw);
  const card = code ? await getLandingCard(createSupabaseServerClient() as unknown as ConnectDbClient, code).catch(() => null) : null;
  if (!card) return <main className={styles.page}><p>That card doesn&apos;t exist.</p></main>;
  const host = (await headers()).get("host");
  const base = process.env.PUBLIC_BASE_URL?.trim() || (host ? `https://${host}` : "");
  const qr = qrSvg(cardLinks(base, card.code).qr, { size: 200, dark: "#000000" });
  return (
    <main className={styles.page}>
      <p className={styles.hint}>Print on A4 at 100%, photocopy as many as you need, and cut along the lines.</p>
      <div className={styles.sheet}>
        {Array.from({ length: 8 }, (_, index) => (
          <section key={index} className={styles.slip}>
            <div className={styles.text}>
              <b>How did we do?</b>
              <span>Scan to review <strong>{card.business?.name ?? "this business"}</strong> on WhatsApp.</span>
              <small>Free · 20 seconds · no app needed</small>
              <small>TrustHub Connect · {card.code}</small>
            </div>
            <div className={styles.qr} dangerouslySetInnerHTML={{ __html: qr }} />
          </section>
        ))}
      </div>
    </main>
  );
}
