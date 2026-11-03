import type { Metadata } from "next";
import Link from "next/link";
import styles from "@/app/deal/deal.module.css";
import { AgentRoom } from "@/app/deal/deal-room";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "TrustHub agent chat", robots: { index: false, follow: false } };

export default async function AgentDealPage({ params }: { params: Promise<{ token: string; id: string }> }) {
  const { token, id } = await params;
  return (
    <main className={styles.page}>
      <Link className={styles.brand} href={`/agent/${token}`}><span className={styles.mark}>T</span><b>← Back to my page</b></Link>
      <AgentRoom agent={token} deal={id} />
    </main>
  );
}
