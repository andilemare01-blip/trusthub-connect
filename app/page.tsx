import type { Metadata } from "next";
import Link from "next/link";
import styles from "./home.module.css";
import { homeFonts } from "./home-fonts";
import { ScrollSteps, TrustField } from "./trust-field";
import { connectWhatsappNumber } from "@/lib/connect/agents";

export const metadata: Metadata = {
  title: "TrustHub: we value trust more than anything",
  description: "TrustHub helps people in Zimbabwe find businesses they can rely on, and gives honest businesses a way to prove it.",
};

const STEPS = ["You ask on WhatsApp.", "Real customers have already answered.", "You choose with your eyes open.", "You tell the next person."];
const PROMISES = ["No business can pay to remove a review.", "No one can buy a rating.", "Scam warnings are free for everyone."];

export default function Home() {
  const number = connectWhatsappNumber();
  return (
    <main className={`${homeFonts} ${styles.page}`}>
      <section className={styles.hero}>
        <TrustField />
        <header className={styles.heroTop}>
          <Link className={styles.wordmark} href="/">TrustHub</Link>
          <a className={styles.signIn} href="#start">Sign in</a>
        </header>
        <div className={styles.heroText}>
          <h1>We value trust more than anything.</h1>
          <p>TrustHub helps people in Zimbabwe find businesses they can rely on, and gives honest businesses a way to prove it.</p>
          <a className={styles.action} href="#start">Get started</a>
        </div>
      </section>

      <section className={styles.question}>
        <p className={styles.statement}>Before you pay the deposit. Before you hand over your car. Before you book the venue. One question decides it: who can I trust?</p>
        <p className={styles.answer}>TrustHub puts what people know about local businesses in one place, so good work gets noticed and bad deals get harder to hide.</p>
      </section>

      <section className={styles.travel}>
        <h2>How trust travels</h2>
        <ScrollSteps steps={STEPS} />
      </section>

      <section className={styles.promises}>
        <h2>What we will never do for money</h2>
        <ul>{PROMISES.map((promise) => <li key={promise}>{promise}</li>)}</ul>
      </section>

      <section className={styles.doors} id="start">
        <h2>Where do you fit in?</h2>
        <div className={styles.door}>
          <a className={styles.doorMain} href="/business?signin=1"><strong>I run a business</strong><span>Claim your page, answer your reviews and get advice from Benita, our AI advisor. It&apos;s free to start.</span></a>
          <a className={styles.doorSide} href="/business?sample=1">See a sample first</a>
        </div>
        <div className={styles.door}>
          <a className={styles.doorMain} href="/agent/join"><strong>I want to be an agent</strong><span>Bring TrustHub to the businesses in your town, and earn commission when they buy.</span></a>
          <a className={styles.doorSide} href="/digital">What businesses can buy</a>
        </div>
        {number ? <div className={styles.door}><a className={styles.doorMain} href={`https://wa.me/${number}?text=Hi`}><strong>I&apos;m a customer</strong><span>You don&apos;t need an account. Say hi on WhatsApp and ask for what you need.</span></a></div> : null}
      </section>

      <footer className={styles.footer}><span>TrustHub</span><Link href="/privacy">Privacy</Link></footer>
    </main>
  );
}
