import type { Metadata } from "next";
import Link from "next/link";
import styles from "@/app/home.module.css";
import { homeFonts } from "@/app/home-fonts";
import { AgentForm } from "./agent-form";

export const metadata: Metadata = { title: "TrustHub agents", description: "Sign in as a TrustHub agent, or apply to become one." };

export default function AgentJoinPage() {
  return (
    <main className={`${homeFonts} ${styles.page}`}>
      <header className={styles.joinTop}><Link className={styles.wordmark} href="/">TrustHub</Link></header>
      <section className={styles.formSection}>
        <h1>Grow the network in your town</h1>
        <p className={styles.muted}>Agents give businesses free review cards, help them join TrustHub, and earn commission when a business buys. Agents are approved by TrustHub.</p>
        <AgentForm />
      </section>
    </main>
  );
}
