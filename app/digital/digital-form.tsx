"use client";

import { useState, type ChangeEvent } from "react";
import styles from "./digital.module.css";

export function DigitalForm({ agent }: { agent: string }) {
  const [form, setForm] = useState({ name: "", business: "", phone: "", website: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = (key: keyof typeof form) => ({ value: form[key], onChange: (event: ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: event.target.value }) });
  async function submit() {
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/deal/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, agent }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "That didn't work. Please try again.");
      window.location.href = body.url;
    } catch (failure) { setError(failure instanceof Error ? failure.message : "That didn't work."); setBusy(false); }
  }
  return (
    <form className={styles.form} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <label>Your name<input required maxLength={80} autoComplete="name" {...field("name")} /></label>
      <label>Business name<input required maxLength={120} autoComplete="organization" {...field("business")} /></label>
      <label>Phone or WhatsApp<input required maxLength={30} inputMode="tel" autoComplete="tel" {...field("phone")} /></label>
      <label className={styles.hidden} aria-hidden="true">Leave this empty<input tabIndex={-1} autoComplete="off" {...field("website")} /></label>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      <button className={styles.primary} type="submit" disabled={busy}>{busy ? "Opening chat…" : "Start the chat"}</button>
    </form>
  );
}
