"use client";

import { useEffect, useState } from "react";
import styles from "../admin.module.css";

/** Where the password-reset email lands: reads the one-time token from the link and sets a new password. */
export default function ResetPassword() {
  const [token, setToken] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const found = params.get("access_token");
    if (found) {
      setToken(found);
      window.history.replaceState(null, "", window.location.pathname);
    } else {
      setLinkError(params.get("error_description")?.replace(/\+/g, " ") ?? "Open this page from the link in your reset email.");
    }
  }, []);

  async function submit() {
    if (password !== again) { setMessage({ kind: "error", text: "The two passwords don't match." }); return; }
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accessToken: token, password }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) setMessage({ kind: "error", text: body.error ?? "Couldn't set that password." });
      else setDone(true);
    } catch { setMessage({ kind: "error", text: "Password reset is temporarily unavailable." }); }
    setBusy(false);
  }

  return (
    <main className={styles.loginPage}>
      <form className={styles.login} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <div className={styles.brand}><span className={styles.mark}>T</span><span><b>TrustHub</b><small>Connect admin</small></span></div>
        <h1>{done ? "Password saved" : "Set a new password"}</h1>
        {done ? (
          <>
            <p className={styles.muted}>Your new password works for the admin app and the TrustHub app.</p>
            <a className={styles.primary} href="/admin">Go to sign in</a>
          </>
        ) : linkError ? (
          <>
            <p className={styles.error} role="status">{linkError}</p>
            <a className={styles.primary} href="/admin">Back to sign in</a>
          </>
        ) : (
          <>
            <label className={styles.field}>New password<input type="password" autoComplete="new-password" autoCapitalize="none" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} required /></label>
            <label className={styles.field}>Type it again<input type="password" autoComplete="new-password" autoCapitalize="none" value={again} onChange={(event) => setAgain(event.target.value)} minLength={8} required /></label>
            {message ? <p className={message.kind === "error" ? styles.error : styles.info} role="status">{message.text}</p> : null}
            <button className={styles.primary} type="submit" disabled={busy || !token || password.length < 8 || !again}>{busy ? "Saving…" : "Save password"}</button>
          </>
        )}
      </form>
    </main>
  );
}
