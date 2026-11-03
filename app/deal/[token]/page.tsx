import type { Metadata } from "next";
import Link from "next/link";
import styles from "../deal.module.css";
import { BusinessRoom } from "../deal-room";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "TrustHub chat", robots: { index: false, follow: false } };

/** The business's private chat with their agent and the Marketing Executive. The link is the key. */
export default async function DealPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <main className={styles.page}>
      <Link className={styles.brand} href="/digital"><span className={styles.mark}>T</span><b>TrustHub Digital Package</b></Link>
      {/^[0-9a-f]{48}$/.test(token) ? <BusinessRoom token={token} /> : <p className={styles.muted}>This chat was not found.</p>}
    </main>
  );
}
