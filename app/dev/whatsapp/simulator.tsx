"use client";

import { useState } from "react";

interface Evidence {
  source: string;
  sourceLabel: string;
  verificationStatus: string;
  confidence: string;
  claim: string;
}
interface InteractiveOption { id: string; title: string; description?: string }
interface Interactive { type: "button" | "list"; body?: string; buttonText?: string; buttons?: InteractiveOption[]; sections?: { title?: string; rows: InteractiveOption[] }[] }
interface TurnResult {
  reply: string;
  interactive: Interactive | null;
  state: string;
  action: string;
  conversationId: string;
  profileId: string;
  whatsappIdentityId: string;
  testIdentity: boolean;
  communityConsentGranted: boolean;
  outcomeConfirmed: boolean;
  contributionId: string | null;
  helpRequestId: string | null;
  understanding: { answerability: string; urgency: string; escalation: string; aiProviderStatus: string; category: string | null; city: string | null };
  resolution: { status: string; confidence: string; uncertainty: string | null; nextAction: string; evidence: Evidence[]; sourceAttempts: { source: string; status: string }[] } | null;
}
interface Bubble { id: string; from: "user" | "trusthub"; text: string; meta?: string; evidence?: Evidence[]; options?: InteractiveOption[]; listLabel?: string }

const panel: React.CSSProperties = { fontFamily: "system-ui, sans-serif", maxWidth: 760, margin: "0 auto", padding: 24 };
const input: React.CSSProperties = { padding: 10, borderRadius: 6, border: "1px solid #ccc", fontSize: 14, boxSizing: "border-box" };
const button: React.CSSProperties = { padding: "10px 18px", borderRadius: 6, border: "none", background: "#25D366", color: "#fff", fontWeight: 600, cursor: "pointer" };

export default function Simulator() {
  const [phone, setPhone] = useState("+263771234567");
  const [text, setText] = useState("");
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<TurnResult | null>(null);

  async function call(payload: object): Promise<{ ok: boolean; data?: TurnResult; error?: string }> {
    try {
      const response = await fetch("/api/dev/whatsapp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber: phone.trim(), ...payload }),
      });
      const data = (await response.json()) as TurnResult & { error?: string };
      return response.ok ? { ok: true, data } : { ok: false, error: data.error ?? `Request failed (${response.status}).` };
    } catch (failure) {
      return { ok: false, error: failure instanceof Error ? failure.message : "Request failed." };
    }
  }

  async function send(event: React.FormEvent) {
    event.preventDefault();
    await deliver(text.trim());
  }

  /** Sends typed text, or a tapped button/list row: the id goes to the server, the label shows in the chat, as on WhatsApp. */
  async function deliver(message: string, label?: string) {
    if (!message || pending) return;
    setPending(true);
    setError(null);
    setBubbles((current) => [...current, { id: `u-${Date.now()}`, from: "user", text: label ?? message }]);
    setText("");

    const outcome = await call({ text: message });
    if (!outcome.ok || !outcome.data) {
      setError(outcome.error ?? "Request failed.");
      setPending(false);
      return;
    }
    const turn = outcome.data;
    setLast(turn);
    setBubbles((current) => [...current, {
      id: `t-${turn.conversationId}-${Date.now()}`,
      from: "trusthub",
      text: turn.interactive?.body ?? turn.reply,
      meta: `${turn.state} / ${turn.action}${turn.testIdentity ? " / test identity" : ""}`,
      evidence: turn.resolution?.evidence,
      options: turn.interactive?.type === "button" ? turn.interactive.buttons : turn.interactive?.sections?.flatMap((section) => section.rows),
      listLabel: turn.interactive?.type === "list" ? turn.interactive.buttonText : undefined,
    }]);
    setPending(false);
  }

  async function clearConversation() {
    setPending(true);
    setError(null);
    const outcome = await call({ reset: true });
    if (!outcome.ok) setError(outcome.error ?? "Reset failed.");
    setBubbles([]);
    setLast(null);
    setPending(false);
  }

  return (
    <main style={panel}>
      <h1 style={{ marginBottom: 4 }}>TrustHub WhatsApp simulator</h1>
      <p style={{ marginTop: 0, color: "#666" }}>
        Development only. Replaces the Meta transport and runs the real TrustHub conversation pipeline against the live database.
      </p>

      <div style={{ display: "flex", gap: 12, alignItems: "flex-end", marginBottom: 16, flexWrap: "wrap" }}>
        <label style={{ flex: "1 1 240px" }}>
          <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>Test sender number (E.164)</div>
          <input style={{ ...input, width: "100%" }} value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+263771234567" />
        </label>
        <button type="button" style={{ ...button, background: "#888" }} onClick={clearConversation} disabled={pending}>
          Clear conversation
        </button>
      </div>

      <div style={{ border: "1px solid #ddd", borderRadius: 8, minHeight: 320, padding: 12, background: "#f5f5f5", marginBottom: 12 }}>
        {bubbles.length === 0 && <p style={{ color: "#999" }}>No messages yet. Use a fresh test number.</p>}
        {bubbles.map((bubble) => (
          <div key={bubble.id} style={{ marginBottom: 10 }}>
            <div style={{
              display: "inline-block",
              maxWidth: "85%",
              padding: "8px 12px",
              borderRadius: 10,
              whiteSpace: "pre-wrap",
              background: bubble.from === "user" ? "#dcf8c6" : "#fff",
              border: bubble.from === "user" ? "none" : "1px solid #e5e5e5",
            }}>
              <div style={{ fontSize: 11, color: "#888", marginBottom: 2 }}>{bubble.from === "user" ? "Tester" : "TrustHub"}</div>
              {bubble.text}
              {bubble.meta && <div style={{ fontSize: 11, color: "#999", marginTop: 4 }}>{bubble.meta}</div>}
            </div>
            {bubble.options && bubble.options.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6, maxWidth: "85%" }}>
                {bubble.listLabel && <div style={{ width: "100%", fontSize: 11, color: "#888" }}>{bubble.listLabel}:</div>}
                {bubble.options.map((option: InteractiveOption) => (
                  <button key={option.id} type="button" disabled={pending} title={option.description}
                    onClick={() => deliver(option.id, option.title)}
                    style={{ padding: "6px 10px", borderRadius: 16, border: "1px solid #25D366", background: "#fff", color: "#128C7E", fontSize: 13, cursor: "pointer" }}>
                    {option.title}
                  </button>
                ))}
              </div>
            )}
            {bubble.evidence && bubble.evidence.length > 0 && (
              <ul style={{ fontSize: 12, color: "#555", margin: "4px 0 0 16px" }}>
                {bubble.evidence.map((item, index) => (
                  <li key={index}>[{item.sourceLabel}] {item.verificationStatus} / {item.confidence}</li>
                ))}
              </ul>
            )}
          </div>
        ))}
        {pending && <p style={{ color: "#888" }}>TrustHub is thinking…</p>}
      </div>

      <form onSubmit={send} style={{ display: "flex", gap: 8 }}>
        <input
          style={{ ...input, flex: 1 }}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Type a message and press Send"
          disabled={pending}
        />
        <button type="submit" style={button} disabled={pending || !text.trim()}>Send</button>
      </form>

      {error && <p style={{ color: "#b00", marginTop: 12 }}>{error}</p>}

      {last && (
        <div style={{ marginTop: 20, fontSize: 12, color: "#555", borderTop: "1px solid #ddd", paddingTop: 12 }}>
          <strong>Last real pipeline result</strong>
          <div>conversation: {last.conversationId} &middot; profile: {last.profileId} &middot; whatsapp identity: {last.whatsappIdentityId}</div>
          <div>understanding: {last.understanding.answerability} / urgency {last.understanding.urgency} / escalation {last.understanding.escalation} / AI {last.understanding.aiProviderStatus}</div>
          <div>contribution: {last.contributionId ?? "none"} &middot; help request: {last.helpRequestId ?? "none"} &middot; consent: {String(last.communityConsentGranted)} &middot; outcome confirmed: {String(last.outcomeConfirmed)}</div>
          {last.resolution && <div>resolution: {last.resolution.status} / confidence {last.resolution.confidence} / next {last.resolution.nextAction}</div>}
          {last.resolution?.sourceAttempts.map((attempt) => <div key={attempt.source}>source {attempt.source}: {attempt.status}</div>)}
        </div>
      )}
    </main>
  );
}
