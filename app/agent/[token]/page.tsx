import type { Metadata } from "next";
import styles from "./agent.module.css";
import { createSupabaseServerClient } from "@/lib/supabase/server-client";
import { maskNumber, shareText } from "@/lib/connect/agents";
import { CopyButton } from "./copy-button";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "TrustHub Agent",
  description: "Your TrustHub Connect link and the people who joined through it.",
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: "TrustHub Agent", statusBarStyle: "default" },
};

type Row = Record<string, unknown>;

/**
 * An agent's private page (the link is the key): their personal link, ready-to-post text, how many people
 * tapped it and joined, who is active this week, and what those people did. Phone numbers are masked.
 */
export default async function AgentPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const db = createSupabaseServerClient();
  const found = /^[0-9a-f]{36}$/.test(token) ? await db.from("connect_agents").select("id,name,code,active").eq("dashboard_token", token).limit(1) : { data: [] };
  const agent = (Array.isArray(found.data) ? found.data[0] : null) as Row | null;
  if (!agent) {
    return <main className={styles.page}><section className={styles.card}><h1>Link not recognised</h1><p className={styles.muted}>Ask the TrustHub team for your agent link.</p></section></main>;
  }
  const stats = db.rpc ? await db.rpc("connect_agent_stats", { p_agent_id: agent.id }) : { data: [], error: null };
  const row = ((Array.isArray(stats.data) ? stats.data[0] : null) ?? {}) as Row;
  const joins = db.rpc ? await db.rpc("connect_agent_people", { p_agent_id: agent.id, p_limit: 25 }) : { data: [], error: null };
  const joinRows = (Array.isArray(joins.data) ? joins.data : []) as Row[];
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? "https://trusthub-connect.vercel.app";
  const link = `${origin}/j/${agent.code}`;
  const post = shareText(link);
  const numbers: [string, unknown, string][] = [
    ["People who joined", row.joined, `${Number(row.joined_week ?? 0)} this week`],
    ["Active this week", row.active_week, "used TrustHub in the last 7 days"],
    ["Link taps", row.clicks, `${Number(row.clicks_week ?? 0)} this week`],
    ["Searches by your people", row.searches, "everything they looked for"],
    ["Reviews by your people", row.reviews, "help everyone trust better"],
    ["Listings by your people", row.listings, "things sold, rented or hired"],
  ];
  return (
    <main className={styles.page}>
      <header className={styles.top}><span className={styles.mark}>T</span><div><b>TrustHub Agent</b><small>{String(agent.name)}{agent.active ? "" : " · paused"}</small></div></header>
      <section className={styles.card}>
        <p className={styles.kicker}>Your link</p>
        <p className={styles.link}>{link}</p>
        <div className={styles.row}><CopyButton text={link} label="Copy link" /><CopyButton text={post} label="Copy a ready post" /></div>
        <p className={styles.muted}>Put it in your WhatsApp status, Facebook, Instagram or TikTok bio. Everyone who taps it and says hi is counted as yours.</p>
      </section>
      <section className={styles.grid}>
        {numbers.map(([label, value, note]) => <div key={label} className={styles.stat}><span>{label}</span><b>{Number(value ?? 0).toLocaleString("en-US")}</b><small>{note}</small></div>)}
      </section>
      <section className={styles.card}>
        <p className={styles.kicker}>People who joined through you</p>
        {joinRows.length ? <ul className={styles.list}>{joinRows.map((join, index) => (
          <li key={index}><b>{join.display_name ? String(join.display_name) : "No name yet"}</b><span>{join.phone_number ? maskNumber(String(join.phone_number)) : "Hidden"} · joined {new Date(String(join.joined_at)).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Africa/Harare" })}</span></li>
        ))}</ul> : <p className={styles.muted}>Nobody yet. Share your link and they will show up here.</p>}
      </section>
      <section className={styles.card}>
        <p className={styles.kicker}>A post you can copy</p>
        <pre className={styles.post}>{post}</pre>
      </section>
    </main>
  );
}
