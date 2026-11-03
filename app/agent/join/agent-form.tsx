"use client";

import { useState } from "react";
import styles from "@/app/home.module.css";

export function AgentForm() {
  const [mode, setMode] = useState<"signin" | "apply">("signin");
  const [form, setForm] = useState({ name: "", phone: "", city: "", email: "", password: "", website: "" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const input = (key: keyof typeof form, label: string, type = "text", auto = "off") => <label>{label}<input type={type} autoComplete={auto} required value={form[key]} maxLength={120} onChange={(event) => setForm({ ...form, [key]: event.target.value })} /></label>;
  async function submit() {
    setBusy(true); setMessage(null);
    try {
      const response = await fetch("/api/agent/account", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, mode }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "That didn't work.");
      if (body.url) { window.location.href = body.url; return; }
      setSent(true);
    } catch (failure) { setMessage(failure instanceof Error ? failure.message : "That didn't work."); }
    setBusy(false);
  }
  if (sent) return <p className={styles.done} role="status"><b>Application sent.</b> We&apos;ll review it and contact you. Once you&apos;re approved, sign in here with the same email and password.</p>;
  return (
    <form className={styles.form} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <div className={styles.switcher}><button type="button" aria-pressed={mode === "signin"} onClick={() => setMode("signin")}>Sign in</button><button type="button" aria-pressed={mode === "apply"} onClick={() => setMode("apply")}>Apply to be an agent</button></div>
      {mode === "apply" ? <>{input("name", "Your full name", "text", "name")}{input("phone", "Phone or WhatsApp", "tel", "tel")}{input("city", "Your city or town")}</> : null}
      {input("email", "Email", "email", "email")}
      {input("password", "Password", "password", mode === "apply" ? "new-password" : "current-password")}
      {mode === "apply" ? <label className={styles.hidden} aria-hidden="true">Leave this empty<input tabIndex={-1} autoComplete="off" value={form.website} onChange={(event) => setForm({ ...form, website: event.target.value })} /></label> : null}
      {message ? <p className={styles.error} role="alert">{message}</p> : null}
      <button className={styles.primary} type="submit" disabled={busy}>{busy ? "One moment…" : mode === "apply" ? "Send application" : "Sign in"}</button>
    </form>
  );
}
