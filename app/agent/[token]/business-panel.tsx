"use client";

import { useState } from "react";
import Link from "next/link";
import styles from "./agent.module.css";

/** Lets an agent open a chat for a business they just met, then gives them the link to send. */
export function NewDeal({ agent }: { agent: string }) {
  const [form, setForm] = useState({ business: "", name: "", phone: "" });
  const [made, setMade] = useState<{ customerLink: string; room: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    setError(null);
    const response = await fetch("/api/agent/deal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agent, ...form }) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) { setError(body.error ?? "That didn't work."); return; }
    setMade(body); setForm({ business: "", name: "", phone: "" });
  }
  const input = (key: keyof typeof form, label: string) => <label className={styles.field}>{label}<input value={form[key]} maxLength={120} onChange={(event) => setForm({ ...form, [key]: event.target.value })} /></label>;
  return (
    <>
      {input("business", "Business name")}{input("name", "Owner's name")}{input("phone", "Phone")}
      {error ? <p className={styles.muted} role="alert">{error}</p> : null}
      <button type="button" className={styles.button} disabled={form.business.trim().length < 2} onClick={() => void submit()}>Open a chat</button>
      {made ? <p className={styles.muted}>Send them this link: {made.customerLink} · <Link href={made.room}>Open the chat</Link></p> : null}
    </>
  );
}
