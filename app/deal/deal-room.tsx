"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./deal.module.css";

type Message = { id: string; sender: "business" | "agent" | "ceo" | "benita"; name: string; body: string; at: string };
export type Deal = { id: string; business: string; stage: string; quoted: number | null; agent: string | null; me: "business" | "agent" | "ceo"; contact: { name: string | null; phone: string | null } | null; ceo_whatsapp: string | null; messages: Message[] };
type Read = () => Promise<Deal>;
type Send = (body: string) => Promise<void>;

const STAGE: Record<string, string> = { new: "New", talking: "Talking", quoted: "Price agreed", won: "Paid", lost: "Closed" };

/** The same room for all three people: business, agent and Marketing Executive. Only what loads it differs. */
export function DealRoom({ read, send }: { read: Read; send: Send }) {
  const [deal, setDeal] = useState<Deal | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const count = useRef(0);
  const load = useCallback(async () => {
    try { const next = await read(); setDeal(next); setError(null); } catch (failure) { setError(failure instanceof Error ? failure.message : "This chat could not be loaded."); }
  }, [read]);
  useEffect(() => { void load(); const timer = setInterval(() => { if (!document.hidden) void load(); }, 6000); return () => clearInterval(timer); }, [load]);
  useEffect(() => { if (deal && deal.messages.length !== count.current) { count.current = deal.messages.length; end.current?.scrollIntoView({ block: "nearest" }); } }, [deal]);
  async function submit() {
    const body = text.trim(); if (!body || busy) return;
    setBusy(true);
    try { await send(body); setText(""); await load(); } catch (failure) { setError(failure instanceof Error ? failure.message : "Your message was not sent."); }
    setBusy(false);
  }
  if (!deal) return <p className={styles.muted} role="status">{error ?? "Opening the chat…"}</p>;
  const whatsapp = deal.ceo_whatsapp ? `https://wa.me/${deal.ceo_whatsapp.replace(/\D/g, "")}?text=${encodeURIComponent(`Hi, this is about ${deal.business} on TrustHub.`)}` : null;
  return (
    <section className={styles.room}>
      <header className={styles.roomHead}>
        <div><b>{deal.business}</b><small>{[deal.agent ? `Agent: ${deal.agent}` : "Agent joining soon", "Marketing Executive", deal.contact?.phone].filter(Boolean).join(" · ")}</small></div>
        <span className={styles.stage}>{STAGE[deal.stage] ?? deal.stage}{deal.quoted ? ` · $${deal.quoted}` : ""}</span>
      </header>
      <div className={styles.thread} aria-live="polite">
        {deal.messages.map((message) => (
          <div key={message.id} className={message.sender === deal.me ? styles.mine : message.sender === "benita" ? styles.ai : styles.theirs}>
            <small>{message.sender === deal.me ? "You" : message.name}</small>
            <p>{message.body}</p>
            <time>{new Date(message.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</time>
          </div>
        ))}
        <div ref={end} />
      </div>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      <form className={styles.compose} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <textarea aria-label="Your message" rows={2} value={text} maxLength={2000} onChange={(event) => setText(event.target.value)} placeholder="Type your message…" />
        <button type="submit" disabled={busy || !text.trim()}>Send</button>
      </form>
      {whatsapp && deal.me === "business" ? <a className={styles.whatsapp} href={whatsapp}>Prefer WhatsApp? Message our Marketing Executive</a> : null}
    </section>
  );
}

async function json(response: Response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? "Something went wrong.");
  return body;
}

export function BusinessRoom({ token }: { token: string }) {
  const read = useCallback(async () => json(await fetch(`/api/deal/room?token=${token}`, { cache: "no-store" })) as Promise<Deal>, [token]);
  const send = useCallback(async (body: string) => { await json(await fetch("/api/deal/room", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, body }) })); }, [token]);
  return <DealRoom read={read} send={send} />;
}

export function AgentRoom({ agent, deal }: { agent: string; deal: string }) {
  const read = useCallback(async () => json(await fetch(`/api/agent/room?agent=${agent}&deal=${deal}`, { cache: "no-store" })) as Promise<Deal>, [agent, deal]);
  const send = useCallback(async (body: string) => { await json(await fetch("/api/agent/room", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agent, deal, body }) })); }, [agent, deal]);
  return <DealRoom read={read} send={send} />;
}
