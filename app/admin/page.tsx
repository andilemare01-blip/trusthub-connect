"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "./dashboard.module.css";
import type { DashboardMetrics } from "@/lib/admin/metrics";

type RangeKey = "today" | "7d" | "30d";
type Payload = DashboardMetrics & { definitions: Record<string, string> };
const RANGES: { key: RangeKey; label: string }[] = [{ key: "today", label: "Today" }, { key: "7d", label: "7 days" }, { key: "30d", label: "30 days" }];
const STALE_MS = 10 * 60_000;
const TOKEN_KEY = "trusthub-admin-token";

function Card({ label, value, hint }: { label: string; value: string | number | null; hint?: string }) {
  return <div className={styles.card}><span className={styles.label}>{label}</span><span className={styles.value}>{value ?? "n/a"}</span>{hint ? <span className={styles.hint}>{hint}</span> : null}</div>;
}
function Rows({ rows, empty }: { rows: { label: string; count: number }[]; empty: string }) {
  return rows.length ? <ul className={styles.list}>{rows.map((row) => <li key={row.label}><span>{row.label}</span><span>{row.count}</span></li>)}</ul> : <p className={styles.empty}>{empty}</p>;
}
const seconds = (value: number | null) => value === null ? "n/a" : value < 90 ? `${value}s` : `${Math.round(value / 60)} min`;
const when = (value: string | null) => value ? new Date(value).toLocaleString() : "never";
const entries = (record: Record<string, number>) => Object.entries(record).map(([label, count]) => ({ label, count }));

export default function AdminDashboardPage() {
  const [draft, setDraft] = useState("");
  const [range, setRange] = useState<RangeKey>("today");
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [token, setToken] = useState(() => (typeof window !== "undefined" ? sessionStorage.getItem(TOKEN_KEY) ?? "" : ""));

  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer); }, []);

  const load = useCallback(async (selected: RangeKey, bearer: string) => {
    if (!bearer) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/dashboard?range=${selected}`, { headers: { Authorization: `Bearer ${bearer}` }, cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) { sessionStorage.removeItem(TOKEN_KEY); setToken(""); }
        throw new Error(typeof body.error === "string" ? body.error : `Request failed (${response.status}).`);
      }
      setData(body as Payload);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "The dashboard could not be loaded."); } finally { setLoading(false); }
  }, [setToken]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    async function refresh() {
      try {
        const response = await fetch(`/api/admin/dashboard?range=${range}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
        const body = await response.json().catch(() => ({}));
        if (cancelled) return;
        if (!response.ok) {
          if (response.status === 401 || response.status === 403) { sessionStorage.removeItem(TOKEN_KEY); setToken(""); }
          throw new Error(typeof body.error === "string" ? body.error : `Request failed (${response.status}).`);
        }
        setData(body as Payload);
      } catch (failure) { if (!cancelled) setError(failure instanceof Error ? failure.message : "The dashboard could not be loaded."); } finally { if (!cancelled) setLoading(false); }
    }
    void refresh();
    return () => { cancelled = true; };
  }, [token, range, setToken]);

  if (!token) {
    return (
      <main className={styles.page}>
        <section className={`${styles.panel} ${styles.gate}`}>
          <h1>TrustHub Connect operations</h1>
          <p className={styles.status}>This page shows no data until the server confirms you are an administrator. Paste a Supabase access token for an admin account; it is kept only for this browser tab.</p>
          {error ? <div className={styles.error} role="alert">{error}</div> : null}
          <textarea aria-label="Supabase access token" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="eyJ..." autoComplete="off" spellCheck={false} />
          <button className={styles.button} onClick={() => { const value = draft.trim(); if (value) { sessionStorage.setItem(TOKEN_KEY, value); setDraft(""); setToken(value); } }}>Open dashboard</button>
        </section>
      </main>
    );
  }

  const stale = data ? now - Date.parse(data.generatedAt) > STALE_MS : false;
  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <div className={styles.title}>
          <h1>TrustHub Connect operations</h1>
          <p>Live data from Supabase. People are WhatsApp identities, never messages or conversations.</p>
        </div>
        <div className={styles.controls}>
          <div className={styles.segment} role="group" aria-label="Date range">
            {RANGES.map((item) => <button key={item.key} aria-pressed={range === item.key} onClick={() => setRange(item.key)}>{item.label}</button>)}
          </div>
          <button className={`${styles.button} ${styles.secondary}`} onClick={() => void load(range, token)} disabled={loading}>{loading ? "Refreshing" : "Refresh"}</button>
          <button className={`${styles.button} ${styles.secondary}`} onClick={() => { sessionStorage.removeItem(TOKEN_KEY); setToken(""); setData(null); }}>Sign out</button>
        </div>
      </header>
      <p className={`${styles.status} ${stale ? styles.stale : ""}`}>{data ? `Updated ${when(data.generatedAt)}${stale ? " (stale, refresh for current numbers)" : ""} · ${data.range.timezone} · from ${when(data.range.start)}` : loading ? "Loading..." : ""}</p>
      {error ? <div className={styles.error} role="alert">{error}</div> : null}
      {!data && loading ? <div className={styles.grid}>{Array.from({ length: 6 }, (_, index) => <div key={index} className={styles.skeleton} />)}</div> : null}
      {data ? <Dashboard data={data} /> : null}
    </main>
  );
}

function Dashboard({ data }: { data: Payload }) {
  const { users, usage, community, notifications, health, meta } = data;
  return (
    <>
      {meta.truncated ? <div className={styles.notice}>Some tables exceeded the read limit, so figures may be understated.</div> : null}
      <section className={styles.section} aria-label="Overview">
        <h2>Overview</h2>
        <div className={styles.grid}>
          <Card label="TrustHub profiles" value={users.profiles.total} hint={`${users.profiles.newInRange} new in range`} />
          <Card label="Active WhatsApp users" value={users.activeWhatsAppUsers.inRange} hint={`daily ${users.activeWhatsAppUsers.daily} · weekly ${users.activeWhatsAppUsers.weekly} · monthly ${users.activeWhatsAppUsers.monthly}`} />
          <Card label="Conversations started" value={usage.conversations.started} hint={`${usage.conversations.active} active in range`} />
          <Card label="Useful answers" value={usage.conversations.withUsefulAnswer} hint="conversations with results" />
          <Card label="Problems solved" value={community.outcomes.usefulAnswerConfirmed} hint="confirmed by the person" />
          <Card label="Time to useful answer" value={seconds(usage.timeToFirstUsefulAnswerSeconds.median)} hint={`median of ${usage.timeToFirstUsefulAnswerSeconds.samples}`} />
        </div>
      </section>

      <section className={styles.section} aria-label="Activity">
        <h2>Activity</h2>
        <div className={styles.grid}>
          <Card label="Messages in" value={usage.messages.inbound} />
          <Card label="Messages out" value={usage.messages.outbound} />
          <Card label="Search requests" value={usage.searchRequests} />
          <Card label="Unanswered requests" value={usage.unansweredRequests} hint="no reliable result" />
          <Card label="New vs returning" value={`${users.newVsReturning.new} / ${users.newVsReturning.returning}`} hint="active people" />
          <Card label="Repeat users" value={users.repeatUsers} hint="2+ conversations, all time" />
        </div>
        <div className={styles.two}>
          <div className={styles.panel}><h3>Registrations</h3><ul className={styles.list}><li><span>Today</span><span>{users.profiles.newToday}</span></li><li><span>Last 7 days</span><span>{users.profiles.new7d}</span></li><li><span>Last 30 days</span><span>{users.profiles.new30d}</span></li></ul></div>
          <div className={styles.panel}><h3>Identities</h3><ul className={styles.list}><li><span>WhatsApp identities</span><span>{users.identities.total}</span></li><li><span>Linked to a profile</span><span>{users.identities.linked}</span></li><li><span>Unlinked (guests)</span><span>{users.identities.unlinked}</span></li><li><span>Conversations with no identity</span><span>{users.conversationsWithoutIdentity}</span></li></ul></div>
        </div>
      </section>

      <section className={styles.section} aria-label="Community demand and gaps">
        <h2>Community demand and information gaps</h2>
        <div className={styles.two}>
          <div className={styles.panel}><h3>Most requested services</h3><Rows rows={usage.topCategories} empty="No service requests in this range." /></div>
          <div className={styles.panel}><h3>Information gaps (inferred demand)</h3>{community.dataGaps.length ? <ul className={styles.list}>{community.dataGaps.map((gap) => <li key={`${gap.category}|${gap.city}`}><span>{gap.category} in {gap.city}</span><span>{gap.requests}</span></li>)}</ul> : <p className={styles.empty}>No unanswered requests in this range.</p>}</div>
          <div className={styles.panel}><h3>Demand by community</h3>{community.demandByCommunity.length ? community.demandByCommunity.map((item) => <div key={item.community}><strong>{item.community}</strong><Rows rows={item.categories} empty="" /></div>) : <p className={styles.empty}>No community demand recorded.</p>}</div>
          <div className={styles.panel}><h3>Records</h3><ul className={styles.list}><li><span>Business records</span><span>{community.knowledge.businesses ?? "n/a"}</span></li><li><span>Knowledge records</span><span>{community.knowledge.knowledgeRecords ?? "n/a"}</span></li><li><span>Business records created in range</span><span>{community.knowledge.businessRecordsCreatedInRange ?? "n/a"}</span></li><li><span>Updates awaiting review</span><span>{community.knowledge.informationUpdatesAwaitingReview ?? "n/a"}</span></li></ul></div>
        </div>
      </section>

      <section className={styles.section} aria-label="Contributions and requests">
        <h2>Contributions and requests</h2>
        <div className={styles.two}>
          <div className={styles.panel}><h3>Help requests</h3><ul className={styles.list}><li><span>Opened</span><span>{community.helpRequests.opened}</span></li><li><span>With community consent</span><span>{community.helpRequests.consented}</span></li><li><span>Still open (now)</span><span>{community.helpRequests.pendingNow}</span></li><li><span>Assigned to a Trust Agent</span><span>{community.helpRequests.assigned ?? "n/a"}</span></li><li><span>Outcomes: matches confirmed</span><span>{community.outcomes.matchConfirmed}</span></li><li><span>Outcomes: resolved</span><span>{community.outcomes.resolved}</span></li></ul></div>
          <div className={styles.panel}><h3>Contributions ({community.contributions.received})</h3><Rows rows={entries(community.contributions.byVerification)} empty="No contributions in this range." /></div>
        </div>
      </section>

      <section className={styles.section} aria-label="Notifications">
        <h2>Notifications</h2>
        <p className={styles.sub}>{notifications.deliveryReceipts}</p>
        <div className={styles.grid}>
          <Card label="WhatsApp missions" value={notifications.whatsappMissions.enabled ? "On" : "Off"} hint={notifications.whatsappMissions.enabled ? "sending enabled" : "dry run only"} />
          <Card label="Eligible now" value={notifications.whatsappMissions.eligibleNow} hint="opted in, inside the 24h window" />
          <Card label="Sent / failed" value={`${notifications.whatsappMissions.sent} / ${notifications.whatsappMissions.failed}`} hint={`${notifications.whatsappMissions.skippedDuplicates} duplicates prevented`} />
          <Card label="Opted out" value={notifications.whatsappMissions.optedOut} hint={`${notifications.whatsappMissions.optedInOrReduced} opted in`} />
          <Card label="Web-app notifications" value={notifications.inApp.total} hint={`${notifications.inApp.read} read`} />
        </div>
      </section>

      <section className={styles.section} aria-label="System health">
        <h2>System health</h2>
        <div className={styles.grid}>
          <Card label="Webhook failures" value={health.webhook.processingFailed} />
          <Card label="Unreadable messages" value={health.webhook.skippedUnreadableMessages} />
          <Card label="Duplicates ignored" value={health.webhook.duplicateDeliveriesIgnored} />
          <Card label="Send failures recorded" value={health.outbound.failuresRecorded} />
          <Card label="Replies without acceptance" value={health.outbound.repliesWithoutProviderAcceptance} hint={`of ${health.outbound.repliesSent} replies`} />
          <Card label="Last successful reply" value={when(health.lastSuccessfulReplyAt)} />
        </div>
        <div className={styles.two}>
          <div className={styles.panel}><h3>Scheduler</h3><ul className={styles.list}><li><span>Cron configured</span><span>{health.scheduler.cronConfigured ? "yes" : "no"}</span></li><li><span>Cron secret set</span><span>{health.scheduler.cronSecretConfigured ? "yes" : "no"}</span></li><li><span>Last verified run</span><span>{when(health.scheduler.lastRunVerified)}</span></li></ul></div>
          <div className={styles.panel}><h3>Recent runtime events</h3>{health.recentEvents.length ? <ul className={styles.list}>{health.recentEvents.map((event, index) => <li key={`${event.at}-${index}`}><span>{event.kind ?? event.name}{event.stage ? ` · ${event.stage}` : ""}</span><span>{when(event.at)}</span></li>)}</ul> : <p className={styles.empty}>No runtime events recorded yet.</p>}</div>
        </div>
      </section>

      <section className={`${styles.panel} ${styles.defs}`} aria-label="Definitions">
        <strong>How to read these numbers</strong>
        {Object.entries(data.definitions).map(([key, text]) => <span key={key}>{text}</span>)}
        <span>Earliest reliable message data: {when(meta.earliestReliableMessage)}. Earlier history is not reconstructed.</span>
      </section>
    </>
  );
}
