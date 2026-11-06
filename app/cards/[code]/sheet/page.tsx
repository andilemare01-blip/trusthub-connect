import type { Metadata } from "next";
import { headers } from "next/headers";
import styles from "./sheet.module.css";
import { createSupabaseServerClient } from "@/lib/supabase/server-client";
import { cardLinks, getLandingCard, normalizeCardCode } from "@/lib/connect/cards";
import { qrSvg } from "@/lib/connect/qr";
import type { ConnectDbClient } from "@/lib/connect/supabase-store";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Printable review sheet", robots: { index: false, follow: false } };

/**
 * Free paper for a business. The WhatsApp code opens WhatsApp itself, so it works on a WhatsApp bundle with no
 * browser data; the second code is for people on Wi-Fi or mobile data. Eight slips to an A4 page by default,
 * or one wall poster with ?layout=poster. Black only, because these get photocopied.
 */
export default async function ReviewSheet({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { code: raw } = await params;
  const poster = (await searchParams).layout === "poster";
  const code = normalizeCardCode(raw);
  const card = code ? await getLandingCard(createSupabaseServerClient() as unknown as ConnectDbClient, code).catch(() => null) : null;
  if (!card) return <main className={styles.page}><p>That card doesn&apos;t exist.</p></main>;
  const host = (await headers()).get("host");
  const base = process.env.PUBLIC_BASE_URL?.trim() || (host ? `https://${host}` : "");
  const links = cardLinks(base, card.code, process.env.TRUSTHUB_WHATSAPP_NUMBER);
  const whatsappQr = links.whatsapp ? qrSvg(links.whatsapp, { size: 300, dark: "#000000" }) : null;
  const appQr = qrSvg(links.appQr, { size: 300, dark: "#000000" });
  const name = card.business?.name ?? "this business";

  const codes = (
    <div className={styles.codes}>
      {whatsappQr ? (
        <figure className={styles.code}>
          <figcaption><b>No data? WhatsApp</b><small>Works on a WhatsApp bundle</small></figcaption>
          <div className={styles.qr} dangerouslySetInnerHTML={{ __html: whatsappQr }} />
        </figure>
      ) : null}
      <figure className={styles.code}>
        <figcaption><b>On Wi-Fi? TrustHub app</b><small>Needs Wi-Fi or mobile data</small></figcaption>
        <div className={styles.qr} dangerouslySetInnerHTML={{ __html: appQr }} />
      </figure>
    </div>
  );

  return (
    <main className={styles.page}>
      {whatsappQr ? <p className={styles.hint}>Print on A4 at 100%, photocopy as many as you need{poster ? "" : ", and cut along the lines"}.</p> : <p className={styles.warning}>The WhatsApp code is missing because TRUSTHUB_WHATSAPP_NUMBER isn&apos;t set. Don&apos;t print this yet.</p>}
      {poster ? (
        <section className={styles.poster}>
          <h1>How did we do?</h1>
          <p>Scan to review <strong>{name}</strong>. Free, about 20 seconds.</p>
          {codes}
          <small>TrustHub Connect · {card.code}</small>
        </section>
      ) : (
        <div className={styles.sheet}>
          {Array.from({ length: 8 }, (_, index) => (
            <section key={index} className={styles.slip}>
              <div className={styles.text}><b>How did we do?</b><span>Scan to review <strong>{name}</strong>. Free, about 20 seconds.</span></div>
              {codes}
              <small className={styles.foot}>TrustHub Connect · {card.code}</small>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
