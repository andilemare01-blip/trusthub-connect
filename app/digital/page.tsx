import type { Metadata } from "next";
import Link from "next/link";
import styles from "./digital.module.css";
import { DigitalForm } from "./digital-form";
import { serverDb, call } from "@/lib/business/server";
import { offersFor, whatsappLink } from "@/lib/business/catalog";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "TrustHub Digital Package: your business online, from $30",
  description: "A fresh website with a strong domain, connected to your TrustHub reviews and WhatsApp.",
};

const INCLUDED = [
  ["A website that opens fast on any phone", "Most of your customers will find you on their phone, often on data bundles. We build for that first."],
  ["A strong domain", "A name people can remember and trust, like yourbusiness.co.zw, instead of only a Facebook page."],
  ["One tap to WhatsApp or call", "Customers reach you straight from the page, with no forms to fill in."],
  ["Your TrustHub reviews on show", "Real reviews from real customers are the best sales pitch you have."],
  ["Your menu, services and prices", "Answer the questions customers ask you all day, before they ask."],
  ["Directions and opening hours", "A map and your hours, so people can walk in without calling first."],
];
const STEPS = [
  ["Chat with us", "Tell your agent and our Marketing Executive what you do."],
  ["Agree the price", "You see the final price and what it covers before you pay anything."],
  ["We build it", "We put your site together and show it to you for changes."],
  ["Go live", "Your domain goes live and customers can find you."],
];

export default async function DigitalPage({ searchParams }: { searchParams: Promise<{ a?: string }> }) {
  const { a } = await searchParams;
  const db = serverDb();
  const settings = db ? await call<{ website_from_usd?: string; ceo_whatsapp?: string }>(db, "deal_settings").catch(() => null) : null;
  const from = settings?.website_from_usd || "30";
  const whatsapp = whatsappLink(settings?.ceo_whatsapp, "Hi, I'd like to know more about the TrustHub Digital Package.");
  const agent = typeof a === "string" && /^[A-Za-z0-9]{3,20}$/.test(a) ? a : "";
  return (
    <main className={styles.page}>
      <header className={styles.top}>
        <Link className={styles.brand} href={agent ? `/business?a=${agent}` : "/business"}><span className={styles.mark}>T</span><b>TrustHub</b></Link>
        <a className={styles.topLink} href="#chat">Chat with an agent</a>
      </header>
      <section className={styles.hero}>
        <p className={styles.kicker}>The TrustHub Digital Package</p>
        <h1>A fresh website with a strong domain, from as little as ${from}</h1>
        <p className={styles.lead}>Customers look you up before they spend. Give them a real home for your business: who you are, what you sell, what people say about you, and one tap to reach you.</p>
        <a className={styles.primary} href="#chat">Chat with an agent</a>
        <p className={styles.fine}>Final price depends on your pages and your domain. We agree it with you in the chat before you pay.</p>
      </section>
      <section className={styles.section}>
        <h2>What your website can do for you</h2>
        <div className={styles.grid}>{INCLUDED.map(([title, body]) => <article key={title} className={styles.card}><h3>{title}</h3><p>{body}</p></article>)}</div>
      </section>
      <section className={styles.band}>
        <h2>Why it works better with TrustHub</h2>
        <p>Your website and your TrustHub page work together. Review cards collect feedback at your counter, Benita Intelligence turns it into tips for your business, and your best reviews can show on your own site.</p>
      </section>
      <section className={styles.section}>
        <h2>How it works</h2>
        <ol className={styles.steps}>{STEPS.map(([title, body]) => <li key={title}><b>{title}</b><span>{body}</span></li>)}</ol>
      </section>
      <section className={styles.section}>
        <h2>And when you&apos;re ready for more</h2>
        <div className={styles.grid}>{offersFor(null).filter((offer) => offer.key !== "website").map((offer) => <article key={offer.key} className={styles.card}><h3>{offer.name} · from ${offer.from}</h3><p>{offer.helps}</p></article>)}</div>
      </section>
      <section className={styles.chat} id="chat">
        <h2>Talk to us</h2>
        <p>You&apos;ll chat with an agent and our Marketing Executive. There&apos;s no cost for asking.</p>
        <DigitalForm agent={agent} />
        {whatsapp ? <a className={styles.whatsapp} href={whatsapp}>Or message us on WhatsApp</a> : null}
      </section>
    </main>
  );
}
