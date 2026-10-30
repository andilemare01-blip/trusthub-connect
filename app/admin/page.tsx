"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./admin.module.css";

type RangeKey = "today" | "7d" | "30d";
type View = "founder" | "overview" | "people" | "agents" | "check" | "cards" | "health" | "try";
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
  benita: {
    recordsBySource: { label: string; total: number }[]; recordsByCity: { label: string; total: number }[];
    webListings: number; whatsappListings: number; facts: number; queue: { label: string; total: number }[];
    lastJobs: { source: string; status: string; accepted: number; at: string; error: string | null }[];
  } | null;
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

type StoredSession = { token: string; refreshToken?: string | null; expiresAt: number };

/** The admin session lives on this device until "Sign out", and renews itself quietly before it expires. */
function readSession(): StoredSession | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = JSON.parse(localStorage.getItem(TOKEN_KEY) ?? sessionStorage.getItem(TOKEN_KEY) ?? "null") as StoredSession | null;
    return stored?.token ? stored : null;
  } catch { return null; }
}
function saveSession(session: StoredSession | null) {
  try {
    if (session) localStorage.setItem(TOKEN_KEY, JSON.stringify(session));
    else localStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
  } catch { /* private mode: the session simply lasts for this visit */ }
}
async function renewSession(refreshToken: string): Promise<StoredSession | null> {
  try {
    const response = await fetch("/api/admin/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refreshToken }) });
    if (!response.ok) return null;
    const body = await response.json() as StoredSession;
    return body.token ? body : null;
  } catch { return null; }
}

const number = (value: number | null | undefined) => (value === null || value === undefined ? "n/a" : value.toLocaleString());

export default function AdminPage() {
  const [session, setSession] = useState<StoredSession | null>(null);
  const [ready, setReady] = useState(false);
  const accept = useCallback((next: StoredSession | null) => { saveSession(next); setSession(next); }, []);
  useEffect(() => {
    const stored = readSession();
    if (stored && stored.expiresAt - Date.now() > 60_000) { setSession(stored); setReady(true); return; }
    if (stored?.refreshToken) {
      void renewSession(stored.refreshToken).then((next) => { accept(next); setReady(true); });
      return;
    }
    accept(null);
    setReady(true);
  }, [accept]);
  // Renew a few minutes before the session runs out, so the console never signs you out mid-task.
  useEffect(() => {
    if (!session?.refreshToken) return;
    const wait = Math.max(30_000, session.expiresAt - Date.now() - 5 * 60_000);
    const timer = window.setTimeout(() => { void renewSession(session.refreshToken as string).then((next) => { if (next) accept(next); }); }, wait);
    return () => window.clearTimeout(timer);
  }, [session, accept]);
  const signOut = useCallback(() => accept(null), [accept]);
  if (!ready) return null;
  if (!session) return <Login onSignedIn={(next) => accept(next)} />;
  return <Console token={session.token} onSignOut={signOut} />;
}

function Login({ onSignedIn }: { onSignedIn: (session: StoredSession) => void }) {
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
      else onSignedIn({ token: body.token, refreshToken: body.refreshToken ?? null, expiresAt: body.expiresAt });
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
  const [view, setView] = useState<View>("founder");
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
    { key: "founder", label: "Founder" },
    { key: "overview", label: "Overview" },
    { key: "people", label: "People" },
    { key: "agents", label: "Agents" },
    { key: "check", label: "To check", badge: waiting },
    { key: "cards", label: "Review cards" },
    { key: "health", label: "System health" },
    { key: "try", label: "Try Wisdom" },
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
        {view === "founder" ? <Founder api={api} /> : null}
        {view === "people" ? <People api={api} /> : null}
        {view === "agents" ? <Agents api={api} /> : null}
        {view === "overview" ? <Overview metrics={metrics} range={range} setRange={setRange} /> : null}
        {view === "check" ? <ToCheck api={api} onChanged={loadMetrics} counts={metrics?.toCheck ?? null} /> : null}
        {view === "cards" ? <Cards api={api} /> : null}
        {view === "health" ? <HealthView api={api} range={range} /> : null}
        {view === "try" ? <TryWisdom api={api} /> : null}
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
            {metrics.benita ? <BenitaPanel benita={metrics.benita} /> : null}
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

/** What Benita knows and what it collected last: the pile that fuels every answer. */
function BenitaPanel({ benita }: { benita: NonNullable<Metrics["benita"]> }) {
  const places = benita.recordsBySource.reduce((sum, item) => sum + item.total, 0);
  const pending = benita.queue.filter((item) => item.label.endsWith(":pending")).reduce((sum, item) => sum + item.total, 0);
  return (
    <section className={styles.panel} style={{ flex: "1 1 320px" }}>
      <h2>Benita knowledge engine</h2>
      <p className={styles.muted}>{number(places)} places · {number(benita.webListings)} web listings · {number(benita.facts)} facts · {number(pending)} pages waiting</p>
      {benita.recordsBySource.slice(0, 8).map((item) => <Line key={item.label} label={item.label} value={item.total} />)}
      <p className={styles.muted}>Latest collection runs</p>
      {benita.lastJobs.slice(0, 6).map((job) => <Line key={`${job.source}-${job.at}`} label={`${job.source} · ${job.status}${job.error ? ` (${job.error})` : ""}`} value={job.accepted} />)}
    </section>
  );
}

type ChatLine = { from: "you" | "wisdom"; text: string; buttons?: string[]; ms?: number };

/** Talk to Wisdom in the browser: the same pipeline and data as WhatsApp, on a private test number. */
function TryWisdom({ api }: { api: Api }) {
  const [phone, setPhone] = useState(() => `+2637000${String(Math.floor(10000 + Math.random() * 89999))}`);
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [lines]);

  async function send(message: string) {
    const said = message.trim();
    if (!said || busy) return;
    setBusy(true); setError(null); setText("");
    setLines((current) => [...current, { from: "you", text: said }]);
    try {
      const reply = await api<{ reply: string; buttons: string[]; list: string[]; ms: number }>("/api/admin/simulate", { method: "POST", body: JSON.stringify({ phoneNumber: phone, text: said }) });
      setLines((current) => [...current, { from: "wisdom", text: reply.reply, buttons: [...(reply.buttons ?? []), ...(reply.list ?? [])], ms: reply.ms }]);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Wisdom could not answer just now.");
    } finally { setBusy(false); }
  }

  const examples = ["Hi", "Hotel in Masvingo", "$1200 house in Borrowdale", "I want to start a business in Harare, what would you advise?", "fuel price today", "7", "Honda Fit for sale"];
  return (
    <>
      <div className={styles.head}><div><h1>Try Wisdom</h1><p className={styles.muted}>The same answers people get on WhatsApp, from live TrustHub and Benita data. You are chatting as {phone}.</p></div>
        <button type="button" className={styles.secondary} onClick={() => { setPhone(`+2637000${String(Math.floor(10000 + Math.random() * 89999))}`); setLines([]); }}>New person</button></div>
      <section className={styles.panel}>
        <div className={styles.chat} aria-live="polite">
          {lines.length === 0 ? <p className={styles.muted}>Say hello, or tap an example below.</p> : null}
          {lines.map((line, index) => (
            <div key={index} className={line.from === "you" ? styles.bubbleYou : styles.bubbleWisdom}>
              <div className={styles.bubbleText}>{line.text}</div>
              {line.buttons?.length ? <div className={styles.tags}>{line.buttons.map((button) => <button type="button" key={button} className={styles.tag} onClick={() => void send(button)} disabled={busy}>{button}</button>)}</div> : null}
              {line.ms ? <small className={styles.muted}>{(line.ms / 1000).toFixed(1)} s</small> : null}
            </div>
          ))}
          {busy ? <div className={styles.bubbleWisdom}><div className={styles.bubbleText}>…</div></div> : null}
          <div ref={endRef} />
        </div>
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        <form className={styles.chatForm} onSubmit={(event) => { event.preventDefault(); void send(text); }}>
          <input className={styles.chatInput} value={text} onChange={(event) => setText(event.target.value)} placeholder="Type a message" aria-label="Message" maxLength={1000} />
          <button type="submit" className={styles.primarySmall} disabled={busy || !text.trim()}>Send</button>
        </form>
        <div className={styles.tags}>{examples.map((example) => <button type="button" key={example} className={styles.tag} onClick={() => void send(example)} disabled={busy}>{example}</button>)}</div>
      </section>
    </>
  );
}

type FounderNumbers = Record<string, number | null>;
type Person = { id: number; display_name: string | null; phone_number: string; joined_at: string; last_active: string | null; searches: number; reviews: number; listings: number; credits: number; agent: string | null; is_test: boolean };
type Agent = { id: number; code: string; name: string; phone: string | null; active: boolean; link: string; dashboard: string; clicks: number; clicksWeek: number; joined: number; joinedWeek: number; activeWeek: number; searches: number; reviews: number; listings: number };
const when = (iso: string | null) => iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Harare" }) : "—";

/** The founder's home: the numbers that say whether TrustHub Connect is growing, and what to do about it. */
function Founder({ api }: { api: Api }) {
  const [numbers, setNumbers] = useState<FounderNumbers | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void api<{ numbers: FounderNumbers }>("/api/admin/people").then((body) => setNumbers(body.numbers)).catch((failure) => setError(failure instanceof Error ? failure.message : "Numbers unavailable.")); }, [api]);
  const n = (key: string) => Number(numbers?.[key] ?? 0);
  const aiUsed = n("aiCallsToday");
  return (
    <>
      <header className={styles.head}><div><h1>Founder</h1><p className={styles.muted}>Everything that matters today. Add this page to your home screen: in your browser menu, tap &quot;Add to Home screen&quot;.</p></div></header>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      <section className={styles.kpis}>
        <Kpi label="People" value={n("people")} note={`${n("peopleToday")} new today · ${n("peopleWeek")} this week`} />
        <Kpi label="Active" value={n("activeToday")} note={`today · ${n("activeWeek")} this week`} />
        <Kpi label="Named" value={n("named")} note="left a name or have a profile" />
        <Kpi label="Searches" value={n("searchesWeek")} note={`this week · ${n("foundRateWeek")}% found something`} warn={n("foundRateWeek") < 50 && n("searchesWeek") > 0} />
        <Kpi label="Reviews" value={n("reviews")} note={`${n("listingsByPeople")} listings posted by people`} />
        <Kpi label="Agents" value={n("agents")} note={`${n("referred")} people joined through agents`} />
      </section>
      <div className={styles.row}>
        <section className={styles.panel} style={{ flex: "1 1 320px" }}>
          <h2>Wisdom&apos;s AI today</h2>
          <Line label="AI calls (last 24 hours)" value={aiUsed} />
          <Line label="Failed calls" value={n("aiFailedToday")} />
          <p className={styles.muted}>{aiUsed >= 40 ? "Close to the free limit of 50 a day. Buy $10 of OpenRouter credit once to raise it to 1,000 a day." : "The free plan allows 50 a day; $10 of OpenRouter credit raises it to 1,000."}</p>
        </section>
        <section className={styles.panel} style={{ flex: "1 1 320px" }}>
          <h2>Benita&apos;s knowledge</h2>
          <Line label="Places and providers" value={n("places")} />
          <Line label="Homes, cars and jobs listed" value={n("webListings")} />
          <Line label="News this week" value={n("news")} />
          <Line label="Database size" value={`${n("dbMb")} MB of 500 MB (free plan)`} />
        </section>
      </div>
    </>
  );
}

/** Everyone who has used Connect: who they are, when they came, what they did and who brought them. */
function People({ api }: { api: Api }) {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [showTests, setShowTests] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void api<{ people: Person[] }>("/api/admin/people").then((body) => setPeople(body.people)).catch((failure) => setError(failure instanceof Error ? failure.message : "People unavailable.")); }, [api]);
  const shown = (people ?? []).filter((person) => showTests || !person.is_test);
  return (
    <>
      <header className={styles.head}><div><h1>People</h1><p className={styles.muted}>Everyone who has messaged TrustHub Connect, most recently active first.</p></div>
        <label className={styles.muted}><input type="checkbox" checked={showTests} onChange={(event) => setShowTests(event.target.checked)} /> Show test chats</label></header>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      <section className={styles.panel}>
        {shown.length ? (
          <div className={styles.tableWrap}><table className={styles.table}>
            <thead><tr><th>Name</th><th>WhatsApp</th><th>Joined</th><th>Last active</th><th>Searches</th><th>Reviews</th><th>Listings</th><th>Credits</th><th>Agent</th></tr></thead>
            <tbody>{shown.map((person) => (
              <tr key={person.id}><td>{person.display_name ?? <span className={styles.muted}>No name yet</span>}</td><td>{person.phone_number}</td><td>{when(person.joined_at)}</td><td>{when(person.last_active)}</td>
                <td>{person.searches}</td><td>{person.reviews}</td><td>{person.listings}</td><td>{person.credits}</td><td>{person.agent ?? "—"}</td></tr>
            ))}</tbody>
          </table></div>
        ) : <p className={styles.muted}>{people ? "Nobody yet." : "Loading…"}</p>}
      </section>
    </>
  );
}

/** Agents: add one, give them their link and private page, and see who brings people in. */
function Agents({ api }: { api: Api }) {
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [made, setMade] = useState<{ code: string; link: string; dashboard: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setAgents((await api<{ agents: Agent[] }>("/api/admin/agents")).agents); } catch (failure) { setError(failure instanceof Error ? failure.message : "Agents unavailable."); setAgents([]); }
  }, [api]);
  useEffect(() => { void load(); }, [load]);
  async function add() {
    setError(null);
    try { setMade(await api<{ code: string; link: string; dashboard: string }>("/api/admin/agents", { method: "POST", body: JSON.stringify({ name, phone }) })); setName(""); setPhone(""); void load(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "The agent could not be added."); }
  }
  async function toggle(agent: Agent) {
    try { await api("/api/admin/agents", { method: "POST", body: JSON.stringify({ id: agent.id, active: !agent.active }) }); void load(); } catch { /* shown on reload */ }
  }
  async function copy(text: string, label: string) { try { await navigator.clipboard.writeText(text); setCopied(label); setTimeout(() => setCopied(null), 2000); } catch { setCopied(null); } }
  return (
    <>
      <header className={styles.head}><div><h1>Agents</h1><p className={styles.muted}>Each agent gets a link to share and a private page showing everyone who joined through them.</p></div></header>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {copied ? <p className={styles.muted} role="status">{copied}</p> : null}
      <div className={styles.row}>
        <section className={styles.panel} style={{ flex: "2 1 560px" }}>
          <h2>Leaderboard</h2>
          {agents?.length ? (
            <div className={styles.tableWrap}><table className={styles.table}>
              <thead><tr><th>Agent</th><th>Joined</th><th>Active this week</th><th>Link taps</th><th>Searches</th><th>Reviews</th><th><span className={styles.srOnly}>Actions</span></th></tr></thead>
              <tbody>{agents.map((agent) => (
                <tr key={agent.id}><td>{agent.name}<div className={styles.small}>{agent.code}{agent.active ? "" : " · paused"}</div></td><td>{agent.joined}<div className={styles.small}>{agent.joinedWeek} this week</div></td><td>{agent.activeWeek}</td><td>{agent.clicks}</td><td>{agent.searches}</td><td>{agent.reviews}</td>
                  <td className={styles.rowActions}><button type="button" className={styles.linkBtn} onClick={() => void copy(agent.link, `${agent.name}'s link copied`)}>Copy link</button><button type="button" className={styles.linkBtn} onClick={() => void copy(agent.dashboard, `${agent.name}'s private page copied`)}>Copy their page</button><button type="button" className={styles.linkBtn} onClick={() => void toggle(agent)}>{agent.active ? "Pause" : "Activate"}</button></td></tr>
              ))}</tbody>
            </table></div>
          ) : <p className={styles.muted}>{agents ? "No agents yet. Add the first one." : "Loading…"}</p>}
        </section>
        <section className={styles.panel} style={{ flex: "1 1 320px" }}>
          <h2>Add an agent</h2>
          <label className={styles.field}>Name<input value={name} onChange={(event) => setName(event.target.value)} maxLength={60} /></label>
          <label className={styles.field}>Phone (optional)<input value={phone} onChange={(event) => setPhone(event.target.value)} maxLength={20} /></label>
          <button type="button" className={styles.primary} onClick={() => void add()} disabled={name.trim().length < 2}>Add agent</button>
          {made ? <div className={styles.note}><p><b>Code {made.code}</b></p><p>Their link to share: {made.link}</p><p>Their private page (send only to them): {made.dashboard}</p></div> : null}
        </section>
      </div>
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

  /** Programs a blank NFC card with this card's link: tap "Write to card", then hold the card to the back of the phone (Chrome on Android). */
  async function writeNfc(url: string, code: string) {
    const Reader = (window as unknown as { NDEFReader?: new () => { write(message: { records: { recordType: string; data: string }[] }): Promise<void> } }).NDEFReader;
    if (!Reader) { setError("Writing NFC cards works in Chrome on an Android phone. Open this admin page there, then tap Write to card again."); return; }
    try {
      setError(null); setCopied(`Hold card ${code} to the back of your phone now…`);
      await new Reader().write({ records: [{ recordType: "url", data: url }] });
      setCopied(`Card ${code} is programmed ✓ Tap it with any phone to test.`);
    } catch (failure) { setCopied(null); setError(failure instanceof Error ? `The card wasn't written: ${failure.message}` : "The card wasn't written. Try again."); }
  }

  async function copy(text: string, label: string) {
    try { await navigator.clipboard.writeText(text); setCopied(label); setTimeout(() => setCopied(null), 2000); } catch { setCopied(null); }
  }

  const totals = useMemo(() => (cards ?? []).reduce((sum, card) => ({ taps: sum.taps + card.taps, reviews: sum.reviews + card.reviews }), { taps: 0, reviews: 0 }), [cards]);

  return (
    <>
      <header className={styles.head}><div><h1>Review cards</h1><p className={styles.muted}>One card per business. Each card has its own link and QR code, and every tap is counted.</p></div></header>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {copied && copied.length > 6 ? <p className={styles.muted} role="status">{copied}</p> : null}
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
                        <button type="button" className={styles.linkBtn} onClick={() => void writeNfc(card.links.nfc, card.code)}>Write to card</button>
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
