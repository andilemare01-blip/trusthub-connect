"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./admin.module.css";

type RangeKey = "today" | "7d" | "30d";
type View = "overview" | "check" | "cards" | "health";
type QueueKind = "reviews" | "listings" | "businesses" | "scams";

interface Metrics {
  totals: { whatsappUsers: number; newWhatsappUsers: number; conversations: number; messages: number; businesses: number; connectReviews: number; listings: number; cards: number };
  toCheck: { reviews: number; listings: number; businesses: number; scamReports: number };
  activity: {
    inboundMessages: number; messagesPerDay: { day: string; total: number }[]; reviews: number; verifiedVisitReviews: number; listings: number; businessesAdded: number;
    cardTaps: number; searches: number; journeys: { label: string; total: number }[]; topSearches: { label: string; total: number }[]; notFound: { category: string; city: string; total: number }[];
  };
  credits: { welcomeGranted: number; earned: number; spentOnDeepQuestions: number; refundsAndAdjustments: number; unused: number; spentInRange: number };
  ai: { callsInRange: number; deepQuestionsInRange: number; costUsdInRange: number; costPerDeepQuestionUsd: number | null };
  assistantNames: { name: string; users: number }[];
}
interface QueueItem { id: string; title: string; detail: string; tags: string[]; status: string; createdAt: string }
interface Card { id: string; code: string; status: "active" | "paused" | "unassigned"; businessName: string | null; businessPlace: string | null; taps: number; reviews: number; newUsers: number; links: { nfc: string; qr: string } }
interface BusinessOption { id: string; name: string; place: string }
interface Health {
  health?: {
    webhook?: { processingFailed?: number; skippedUnreadableMessages?: number; duplicateDeliveriesIgnored?: number };
    outbound?: { failuresRecorded?: number; repliesWithoutProviderAcceptance?: number; repliesSent?: number };
    identity?: { unlinkedIdentities?: number; conversationsWithoutIdentity?: number };
    lastSuccessfulReplyAt?: string | null;
  };
}

const TOKEN_KEY = "trusthub-admin-session";
const RANGES: { key: RangeKey; label: string }[] = [{ key: "today", label: "Today" }, { key: "7d", label: "7 days" }, { key: "30d", label: "30 days" }];
const QUEUES: { key: QueueKind; label: string; approve: string; reject: string; empty: string }[] = [
  { key: "reviews", label: "Reviews", approve: "Publish", reject: "Hide", empty: "No reviews to check." },
  { key: "listings", label: "Listings", approve: "Approve", reject: "Reject", empty: "No listings waiting." },
  { key: "businesses", label: "New businesses", approve: "Add to directory", reject: "Reject", empty: "No submitted businesses waiting." },
  { key: "scams", label: "Scam reports", approve: "Confirm", reject: "Dismiss", empty: "No open scam reports." },
];

function readSession(): string {
  if (typeof window === "undefined") return "";
  try {
    const stored = JSON.parse(sessionStorage.getItem(TOKEN_KEY) ?? "null") as { token?: string; expiresAt?: number } | null;
    return stored?.token && (stored.expiresAt ?? 0) > Date.now() ? stored.token : "";
  } catch { return ""; }
}

const number = (value: number | null | undefined) => (value === null || value === undefined ? "n/a" : value.toLocaleString());

export default function AdminPage() {
  const [token, setToken] = useState("");
  const [ready, setReady] = useState(false);
  useEffect(() => { setToken(readSession()); setReady(true); }, []);
  const signOut = useCallback(() => { sessionStorage.removeItem(TOKEN_KEY); setToken(""); }, []);
  if (!ready) return null;
  if (!token) return <Login onSignedIn={(value, expiresAt) => { sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ token: value, expiresAt })); setToken(value); }} />;
  return <Console token={token} onSignOut={signOut} />;
}

function Login({ onSignedIn }: { onSignedIn: (token: string, expiresAt: number) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "info"; text: string } | null>(null);

  async function submit(reset: boolean) {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(reset ? { email, reset: true } : { email, password }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) setMessage({ kind: "error", text: body.error ?? "Sign-in failed." });
      else if (reset) setMessage({ kind: "info", text: body.message });
      else onSignedIn(body.token, body.expiresAt);
    } catch { setMessage({ kind: "error", text: "Sign-in is temporarily unavailable." }); }
    setBusy(false);
  }

  return (
    <main className={styles.loginPage}>
      <form className={styles.login} onSubmit={(event) => { event.preventDefault(); void submit(false); }}>
        <div className={styles.brand}><span className={styles.mark}>T</span><span><b>TrustHub</b><small>Connect admin</small></span></div>
        <h1>Sign in</h1>
        <p className={styles.muted}>Use your TrustHub account. Only administrators can open this page.</p>
        <label className={styles.field}>Email<input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
        <label className={styles.field}>Password<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        {message ? <p className={message.kind === "error" ? styles.error : styles.info} role="status">{message.text}</p> : null}
        <button className={styles.primary} type="submit" disabled={busy || !email || !password}>{busy ? "Signing in…" : "Sign in"}</button>
        <button className={styles.link} type="button" disabled={busy || !email} onClick={() => void submit(true)}>Forgot your password?</button>
      </form>
    </main>
  );
}

function Console({ token, onSignOut }: { token: string; onSignOut: () => void }) {
  const [view, setView] = useState<View>("overview");
  const [range, setRange] = useState<RangeKey>("7d");
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  const api = useCallback(async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(path, { ...init, headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (response.status === 401 || response.status === 403) { onSignOut(); throw new Error(body.error ?? "Please sign in again."); }
    if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status}).`);
    return body as T;
  }, [token, onSignOut]);

  const loadMetrics = useCallback(async () => {
    try { setMetrics(await api<Metrics>(`/api/admin/connect?range=${range}`)); setError(null); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "The overview could not be loaded."); }
  }, [api, range]);
  useEffect(() => { void loadMetrics(); }, [loadMetrics]);

  const waiting = metrics ? metrics.toCheck.reviews + metrics.toCheck.listings + metrics.toCheck.businesses + metrics.toCheck.scamReports : 0;
  const nav: { key: View; label: string; badge?: number }[] = [
    { key: "overview", label: "Overview" },
    { key: "check", label: "To check", badge: waiting },
    { key: "cards", label: "Review cards" },
    { key: "health", label: "System health" },
  ];

  return (
    <div className={styles.shell}>
      <aside className={styles.side}>
        <div className={styles.brand}><span className={styles.mark}>T</span><span><b>TrustHub</b><small>Connect admin</small></span></div>
        <nav className={styles.nav} aria-label="Admin sections">
          {nav.map((item) => (
            <button key={item.key} type="button" className={view === item.key ? styles.navOn : styles.navItem} onClick={() => setView(item.key)} aria-current={view === item.key ? "page" : undefined}>
              {item.label}{item.badge ? <span className={styles.badge}>{item.badge}</span> : null}
            </button>
          ))}
        </nav>
        <button type="button" className={styles.signOut} onClick={onSignOut}>Sign out</button>
      </aside>
      <main className={styles.main}>
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        {view === "overview" ? <Overview metrics={metrics} range={range} setRange={setRange} /> : null}
        {view === "check" ? <ToCheck api={api} onChanged={loadMetrics} counts={metrics?.toCheck ?? null} /> : null}
        {view === "cards" ? <Cards api={api} /> : null}
        {view === "health" ? <HealthView api={api} range={range} /> : null}
      </main>
    </div>
  );
}

function Overview({ metrics, range, setRange }: { metrics: Metrics | null; range: RangeKey; setRange: (range: RangeKey) => void }) {
  const peak = Math.max(1, ...(metrics?.activity.messagesPerDay.map((day) => day.total) ?? [1]));
  const journeyPeak = Math.max(1, ...(metrics?.activity.journeys.map((item) => item.total) ?? [1]));
  return (
    <>
      <header className={styles.head}>
        <div><h1>Overview</h1><p className={styles.muted}>All of TrustHub Connect at a glance. Activity numbers cover the selected period.</p></div>
        <div className={styles.pills} role="group" aria-label="Period">
          {RANGES.map((item) => <button key={item.key} type="button" className={range === item.key ? styles.pillOn : styles.pill} onClick={() => setRange(item.key)}>{item.label}</button>)}
        </div>
      </header>
      {!metrics ? <p className={styles.muted}>Loading…</p> : (
        <>
          <div className={styles.kpis}>
            <Kpi label="WhatsApp users" value={metrics.totals.whatsappUsers} note={`${metrics.totals.newWhatsappUsers} new in this period`} />
            <Kpi label="Messages received" value={metrics.activity.inboundMessages} note={`${number(metrics.totals.messages)} stored in total`} />
            <Kpi label="Reviews" value={metrics.activity.reviews} note={`${metrics.activity.verifiedVisitReviews} from card taps`} />
            <Kpi label="Listings posted" value={metrics.activity.listings} note={`${metrics.toCheck.listings} waiting to be checked`} warn={metrics.toCheck.listings > 0} />
            <Kpi label="Businesses" value={metrics.totals.businesses} note={`${metrics.activity.businessesAdded} submitted this period`} />
            <Kpi label="Searches, no result" value={metrics.activity.notFound.reduce((sum, item) => sum + item.total, 0)} note="demand nobody serves yet" />
          </div>
          <div className={styles.row}>
            <section className={styles.panel} style={{ flex: "2 1 420px" }}>
              <h2>Messages per day</h2>
              <p className={styles.muted}>Inbound WhatsApp messages, by day in Harare time.</p>
              {metrics.activity.messagesPerDay.length ? (
                <div className={styles.bars} role="img" aria-label="Messages per day">
                  {metrics.activity.messagesPerDay.map((day) => (
                    <div key={day.day} className={styles.barCol} title={`${day.day}: ${day.total}`}>
                      <span className={styles.barValue}>{day.total}</span>
                      <span className={styles.bar} style={{ height: `${Math.max(4, (day.total / peak) * 140)}px` }} />
                      <span className={styles.barLabel}>{day.day.slice(5)}</span>
                    </div>
                  ))}
                </div>
              ) : <p className={styles.empty}>No messages in this period.</p>}
            </section>
            <section className={styles.panel} style={{ flex: "1 1 280px" }}>
              <h2>Credits</h2>
              <p className={styles.muted}>Free credits only for now. No payments.</p>
              <Line label="Welcome credits given" value={metrics.credits.welcomeGranted} />
              <Line label="Earned by contributing" value={metrics.credits.earned} />
              <Line label="Spent on deep questions" value={metrics.credits.spentOnDeepQuestions} />
              <Line label="Still unused" value={metrics.credits.unused} />
              <Line label="AI cost this period" value={`$${metrics.ai.costUsdInRange.toFixed(2)}`} />
              <p className={styles.note}>{metrics.ai.costPerDeepQuestionUsd === null ? "No deep questions yet, so there's no cost per question to price from." : `Average cost per deep question: $${metrics.ai.costPerDeepQuestionUsd.toFixed(2)}. Use this to set a price later.`}</p>
            </section>
          </div>
          <div className={styles.row}>
            <section className={styles.panel} style={{ flex: "1 1 320px" }}>
              <h2>What people use</h2>
              <p className={styles.muted}>Searches by journey this period</p>
              {metrics.activity.journeys.length ? metrics.activity.journeys.map((item) => (
                <div key={item.label} className={styles.hbar}><span>{item.label}</span><span className={styles.track}><span style={{ width: `${(item.total / journeyPeak) * 100}%` }} /></span><b>{item.total}</b></div>
              )) : <p className={styles.empty}>No searches yet.</p>}
            </section>
            <section className={styles.panel} style={{ flex: "1 1 320px" }}>
              <h2>Searched, but not found</h2>
              <p className={styles.muted}>Add these businesses first</p>
              {metrics.activity.notFound.length ? metrics.activity.notFound.map((item) => <Line key={`${item.category}-${item.city}`} label={`${item.category} · ${item.city}`} value={`${item.total}×`} />) : <p className={styles.empty}>Nothing yet. This fills up as people search.</p>}
            </section>
            <section className={styles.panel} style={{ flex: "1 1 240px" }}>
              <h2>Assistant names</h2>
              <p className={styles.muted}>Each person always meets the same name</p>
              {metrics.assistantNames.filter((item) => item.users > 0).map((item) => <Line key={item.name} label={item.name} value={`${item.users} ${item.users === 1 ? "user" : "users"}`} />)}
            </section>
          </div>
        </>
      )}
    </>
  );
}

function Kpi({ label, value, note, warn }: { label: string; value: number; note: string; warn?: boolean }) {
  return <div className={styles.kpi}><span className={styles.kpiLabel}>{label}</span><span className={warn ? styles.kpiWarn : styles.kpiValue}>{number(value)}</span><span className={styles.kpiNote}>{note}</span></div>;
}

function Line({ label, value }: { label: string; value: string | number }) {
  return <div className={styles.line}><span>{label}</span><b>{typeof value === "number" ? number(value) : value}</b></div>;
}

type Api = <T>(path: string, init?: RequestInit) => Promise<T>;

function ToCheck({ api, onChanged, counts }: { api: Api; onChanged: () => void; counts: Metrics["toCheck"] | null }) {
  const [kind, setKind] = useState<QueueKind>("reviews");
  const [items, setItems] = useState<QueueItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const queue = QUEUES.find((item) => item.key === kind)!;
  const load = useCallback(async () => {
    setItems(null);
    try { setItems((await api<{ items: QueueItem[] }>(`/api/admin/queue?kind=${kind}`)).items); setError(null); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "The list could not be loaded."); setItems([]); }
  }, [api, kind]);
  useEffect(() => { void load(); }, [load]);

  async function decide(id: string, decision: "approve" | "reject") {
    try {
      await api("/api/admin/queue", { method: "POST", body: JSON.stringify({ kind, id, decision }) });
      // A published review stays listed as live; anything else that was decided leaves the list.
      setItems((current) => current?.flatMap((item) => item.id !== id ? [item] : kind === "reviews" && decision === "approve" ? [{ ...item, status: "published" }] : []) ?? null);
      onChanged();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "That change could not be saved."); }
  }

  const badge: Record<QueueKind, number> = { reviews: counts?.reviews ?? 0, listings: counts?.listings ?? 0, businesses: counts?.businesses ?? 0, scams: counts?.scamReports ?? 0 };
  return (
    <>
      <header className={styles.head}><div><h1>To check</h1><p className={styles.muted}>New contributions wait here until someone checks them. Nothing here is shown as verified until you approve it.</p></div></header>
      <div className={styles.pills} role="tablist">
        {QUEUES.map((item) => <button key={item.key} type="button" role="tab" aria-selected={kind === item.key} className={kind === item.key ? styles.pillOn : styles.pill} onClick={() => setKind(item.key)}>{item.label}{badge[item.key] ? ` · ${badge[item.key]}` : ""}</button>)}
      </div>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      <section className={styles.panel}>
        {items === null ? <p className={styles.muted}>Loading…</p> : items.length === 0 ? <p className={styles.empty}>{queue.empty}</p> : items.map((item) => (
          <div key={item.id} className={styles.item}>
            <div className={styles.itemText}>
              <b>{item.title}</b>
              <span>{item.detail}</span>
              <span className={styles.tags}>{[...item.tags, item.status === "published" ? "Live" : "", new Date(item.createdAt).toLocaleString()].filter(Boolean).map((tag) => <span key={tag} className={styles.tag}>{tag}</span>)}</span>
            </div>
            <div className={styles.itemActions}>
              {item.status !== "published" ? <button type="button" className={styles.primarySmall} onClick={() => void decide(item.id, "approve")}>{queue.approve}</button> : null}
              <button type="button" className={styles.secondary} onClick={() => void decide(item.id, "reject")}>{queue.reject}</button>
            </div>
          </div>
        ))}
      </section>
    </>
  );
}

function Cards({ api }: { api: Api }) {
  const [cards, setCards] = useState<Card[] | null>(null);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<BusinessOption[]>([]);
  const [chosen, setChosen] = useState<BusinessOption | null>(null);
  const [created, setCreated] = useState<{ code: string; links: Card["links"] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setCards((await api<{ cards: Card[] }>("/api/admin/cards")).cards); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "The cards could not be loaded."); setCards([]); }
  }, [api]);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (chosen || query.trim().length < 2) { setOptions([]); return; }
    const timer = setTimeout(async () => {
      try { setOptions((await api<{ businesses: BusinessOption[] }>(`/api/admin/businesses?q=${encodeURIComponent(query)}`)).businesses); } catch { setOptions([]); }
    }, 250);
    return () => clearTimeout(timer);
  }, [query, chosen, api]);

  async function create() {
    if (!chosen) return;
    setError(null);
    try {
      const result = await api<{ card: { code: string; links: Card["links"] } }>("/api/admin/cards", { method: "POST", body: JSON.stringify({ businessId: chosen.id }) });
      setCreated(result.card);
      setChosen(null);
      setQuery("");
      void load();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "The card could not be created."); }
  }

  async function setStatus(card: Card, status: Card["status"]) {
    try { await api("/api/admin/cards", { method: "PATCH", body: JSON.stringify({ id: card.id, status }) }); void load(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "The card could not be updated."); }
  }

  async function copy(text: string, label: string) {
    try { await navigator.clipboard.writeText(text); setCopied(label); setTimeout(() => setCopied(null), 2000); } catch { setCopied(null); }
  }

  const totals = useMemo(() => (cards ?? []).reduce((sum, card) => ({ taps: sum.taps + card.taps, reviews: sum.reviews + card.reviews }), { taps: 0, reviews: 0 }), [cards]);

  return (
    <>
      <header className={styles.head}><div><h1>Review cards</h1><p className={styles.muted}>One card per business. Each card has its own link and QR code, and every tap is counted.</p></div></header>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      <div className={styles.row}>
        <section className={styles.panel} style={{ flex: "2 1 560px" }}>
          <h2>All cards</h2>
          <p className={styles.muted}>{cards?.length ? `${totals.taps} taps and ${totals.reviews} reviews across ${cards.length} cards. Show each business what its card brings in.` : "No cards yet. Create the first one on the right."}</p>
          {cards?.length ? (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead><tr><th>Card</th><th>Business</th><th>Status</th><th>Taps</th><th>Reviews</th><th>New users</th><th><span className={styles.srOnly}>Actions</span></th></tr></thead>
                <tbody>
                  {cards.map((card) => (
                    <tr key={card.id}>
                      <td className={styles.codeCell}>{card.code}</td>
                      <td>{card.businessName ?? "Not assigned"}{card.businessPlace ? <div className={styles.small}>{card.businessPlace}</div> : null}</td>
                      <td><span className={card.status === "active" ? styles.statusOn : styles.statusOff}>{card.status === "active" ? "Active" : card.status === "paused" ? "Paused" : "Unassigned"}</span></td>
                      <td>{card.taps}</td><td>{card.reviews}</td><td>{card.newUsers}</td>
                      <td className={styles.rowActions}>
                        <a className={styles.linkBtn} href={`/cards/${card.code}/print`} target="_blank" rel="noreferrer">Print</a>
                        {card.status === "active" ? <button type="button" className={styles.linkBtn} onClick={() => void setStatus(card, "paused")}>Pause</button> : card.status === "paused" ? <button type="button" className={styles.linkBtn} onClick={() => void setStatus(card, "active")}>Activate</button> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
        <section className={styles.panel} style={{ flex: "1 1 320px" }}>
          <h2>New card</h2>
          <p className={styles.muted}>About a minute per business</p>
          <h3 className={styles.step}><span>1</span>Pick the business</h3>
          <label className={styles.field}>Search the directory
            <input value={chosen ? chosen.name : query} onChange={(event) => { setChosen(null); setQuery(event.target.value); }} placeholder="Business name" />
          </label>
          {options.length ? (
            <ul className={styles.options}>
              {options.map((option) => <li key={option.id}><button type="button" onClick={() => { setChosen(option); setOptions([]); }}><b>{option.name}</b><span>{option.place}</span></button></li>)}
            </ul>
          ) : null}
          <button type="button" className={styles.primary} disabled={!chosen} onClick={() => void create()}>Create card</button>
          {created ? (
            <>
              <h3 className={styles.step}><span>2</span>Card {created.code} is ready</h3>
              <div className={styles.qrRow}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/cards/${created.code}/qr`} alt={`QR code for card ${created.code}`} width={112} height={112} />
                <div className={styles.qrLinks}>
                  <span className={styles.small}>Link for the NFC chip</span>
                  <b className={styles.breakAll}>{created.links.nfc}</b>
                  <button type="button" className={styles.secondary} onClick={() => void copy(created.links.nfc, "nfc")}>{copied === "nfc" ? "Copied" : "Copy NFC link"}</button>
                </div>
              </div>
              <h3 className={styles.step}><span>3</span>Make the card</h3>
              <div className={styles.actionsRow}>
                <a className={styles.primarySmall} href={`/api/cards/${created.code}/qr?download=1`}>Download QR</a>
                <a className={styles.secondary} href={`/cards/${created.code}/print`} target="_blank" rel="noreferrer">Print card</a>
              </div>
              <p className={styles.note}>To write the chip: open a free NFC app (such as NFC Tools), choose Write, add a URL record with the NFC link above, tap the card, then lock it. If a business closes, pause the card here; there's no need to reprint.</p>
            </>
          ) : null}
        </section>
      </div>
    </>
  );
}

function HealthView({ api, range }: { api: Api; range: RangeKey }) {
  const [data, setData] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<Health>(`/api/admin/dashboard?range=${range}`).then(setData).catch((failure) => setError(failure instanceof Error ? failure.message : "Health could not be loaded."));
  }, [api, range]);
  const health = data?.health;
  return (
    <>
      <header className={styles.head}><div><h1>System health</h1><p className={styles.muted}>Is WhatsApp delivery working? Covers the period chosen on the overview.</p></div></header>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {!health ? <p className={styles.muted}>Loading…</p> : (
        <div className={styles.row}>
          <section className={styles.panel} style={{ flex: "1 1 300px" }}>
            <h2>WhatsApp delivery</h2>
            <Line label="Replies sent" value={health.outbound?.repliesSent ?? 0} />
            <Line label="Send failures" value={health.outbound?.failuresRecorded ?? 0} />
            <Line label="Replies WhatsApp didn't confirm" value={health.outbound?.repliesWithoutProviderAcceptance ?? 0} />
            <Line label="Last confirmed reply" value={health.lastSuccessfulReplyAt ? new Date(health.lastSuccessfulReplyAt).toLocaleString() : "None yet"} />
          </section>
          <section className={styles.panel} style={{ flex: "1 1 300px" }}>
            <h2>Incoming messages</h2>
            <Line label="Processing failures" value={health.webhook?.processingFailed ?? 0} />
            <Line label="Unreadable messages skipped" value={health.webhook?.skippedUnreadableMessages ?? 0} />
            <Line label="Duplicate deliveries ignored" value={health.webhook?.duplicateDeliveriesIgnored ?? 0} />
          </section>
          <section className={styles.panel} style={{ flex: "1 1 300px" }}>
            <h2>Identity</h2>
            <Line label="WhatsApp users without a TrustHub profile" value={health.identity?.unlinkedIdentities ?? 0} />
            <Line label="Conversations without a WhatsApp user" value={health.identity?.conversationsWithoutIdentity ?? 0} />
          </section>
        </div>
      )}
    </>
  );
}
