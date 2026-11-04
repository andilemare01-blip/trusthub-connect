"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./admin.module.css";
import { DealRoom, type Deal } from "../deal/deal-room";
import { PRODUCT_LABEL } from "@/lib/business/catalog";

type Api = <T>(path: string, init?: RequestInit) => Promise<T>;
type Claim = { id: string; business: string; city: string | null; listed_phone: string | null; applicant: string; role: string; phone: string; notes: string | null; has_owner: boolean };
type Pending = { id: string; business: string; product: string; amount: number | null; method: string | null; ref: string | null; agent: string | null };
type OpenDeal = { id: string; business: string; package: string; contact: string | null; phone: string | null; stage: string; quoted: number | null; agent_id: number | null; agent: string | null; last_text: string | null; unread: boolean };
type AgentRow = { id: number; name: string; code: string; active: boolean };
type CardRow = { id: string; code: string; agent_id: number | null; business: string | null };
type Application = { id: number; name: string; phone: string | null; city: string | null };
type NewBusiness = { id: string; name: string; category: string | null; city: string; area: string | null; address: string | null; phone: string; applicant: string; role: string; matches: number };
type Desk = { new_businesses: NewBusiness[]; applications: Application[]; claims: Claim[]; payments: Pending[]; deals: OpenDeal[]; agents: AgentRow[]; cards: CardRow[]; settings: Record<string, string> };
type Sale = { id: string; at: string; business: string; city: string | null; product: string; amount: number; method: string | null; ref: string | null; agent: string | null; commission: number | null; commission_status: string | null; commission_id: string | null };
type Revenue = { totals: { revenue: number; sales: number; commission_owed: number; commission_paid: number; net: number }; by_agent: { agent: string; agent_id: number | null; revenue: number; sales: number; owed: number; paid: number }[]; by_product: { product: string; revenue: number; sales: number }[]; by_month: { month: string; revenue: number }[]; rows: Sale[]; cities: string[] };

const usd = (value: number | null | undefined) => `$${Number(value ?? 0).toFixed(2)}`;
const post = (body: unknown) => ({ method: "POST", body: JSON.stringify(body) });
const PATH = "/api/admin/business";
const PERIODS: [string, string][] = [["30", "Last 30 days"], ["7", "Last 7 days"], ["month", "This month"], ["all", "All time"], ["custom", "Choose dates"]];

/** The CEO's section: claims, payments, chats, revenue, commissions and the network. Only admins reach this tab or its API. */
export function BusinessView({ api }: { api: Api }) {
  const [tab, setTab] = useState<"today" | "revenue" | "credits" | "network">("today");
  const [desk, setDesk] = useState<Desk | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setDesk(await api<Desk>(PATH)); setError(null); } catch (failure) { setError(failure instanceof Error ? failure.message : "The desk could not be loaded."); }
  }, [api]);
  useEffect(() => { void load(); }, [load]);
  const act = useCallback(async <T,>(body: unknown, done?: (result: T) => string): Promise<boolean> => {
    setError(null); setNote(null);
    try { const result = await api<T>(PATH, post(body)); if (done) setNote(done(result)); await load(); return true; }
    catch (failure) { setError(failure instanceof Error ? failure.message : "That change could not be saved."); return false; }
  }, [api, load]);
  const waiting = (desk?.new_businesses.length ?? 0) + (desk?.applications.length ?? 0) + (desk?.claims.length ?? 0) + (desk?.payments.length ?? 0) + (desk?.deals.filter((deal) => deal.unread).length ?? 0);
  return (
    <>
      <header className={styles.head}><div><h1>Business</h1><p className={styles.muted}>Your company at a glance. Businesses and agents only ever see their own part of this.</p></div></header>
      <div className={styles.pills} role="tablist">
        {([["today", `Today${waiting ? ` (${waiting})` : ""}`], ["revenue", "Revenue"], ["credits", "Credits"], ["network", "Network"]] as const).map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? styles.pillOn : styles.pill} onClick={() => setTab(key)}>{label}</button>)}
      </div>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {note ? <p className={styles.info} role="status">{note}</p> : null}
      {!desk ? <p className={styles.muted}>Loading…</p> : tab === "today" ? <Today api={api} desk={desk} act={act} /> : tab === "revenue" ? <RevenueView api={api} desk={desk} act={act} /> : tab === "credits" ? <CreditsView api={api} /> : <Network desk={desk} act={act} />}
    </>
  );
}

type Act = <T>(body: unknown, done?: (result: T) => string) => Promise<boolean>;

function Today({ api, desk, act }: { api: Api; desk: Desk; act: Act }) {
  const [open, setOpen] = useState<string | null>(null);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const approved = (result: { approved: number; skipped: number }) => `${result.approved} approved${result.skipped ? `. ${result.skipped} left for you: that business already has an owner or an earlier claim.` : "."}`;
  return (
    <>
      {desk.applications.length ? <section className={styles.panel}>
        <h2>People who want to be agents</h2>
        {desk.applications.map((person) => <div key={person.id} className={styles.item}><div className={styles.itemText}><b>{person.name}</b><span>{[person.phone, person.city].filter(Boolean).join(" · ")}</span></div><div className={styles.itemActions}><button type="button" className={styles.primarySmall} onClick={() => void act({ action: "agent-decide", id: person.id, approve: true }, () => `${person.name} is now an agent.`)}>Approve</button><button type="button" className={styles.linkBtn} onClick={() => void act({ action: "agent-decide", id: person.id, approve: false })}>Reject</button></div></div>)}
      </section> : null}
      {desk.new_businesses.length ? <section className={styles.panel}>
        <h2>New businesses to confirm</h2>
        <p className={styles.muted}>These aren&apos;t public yet. Call the number first. Approving lists the business and makes this person its owner.</p>
        {desk.new_businesses.map((item) => <div key={item.id} className={styles.item}><div className={styles.itemText}><b>{item.name}</b><span>{[item.category, item.area, item.city].filter(Boolean).join(", ")}{item.address ? `. ${item.address}` : ""}</span><span>{item.applicant}, {item.role}: <a href={`tel:${item.phone}`}>{item.phone}</a></span>{item.matches ? <span className={styles.tags}><span className={styles.tag}>Same name is already listed</span></span> : null}</div><div className={styles.itemActions}><button type="button" className={styles.primarySmall} onClick={() => void act({ action: "new-business", id: item.id, approve: true }, () => `${item.name} is confirmed and listed.`)}>Confirm and list</button><button type="button" className={styles.linkBtn} onClick={() => void act({ action: "new-business", id: item.id, approve: false })}>Reject</button></div></div>)}
      </section> : null}
      <section className={styles.panel}>
        <div className={styles.head}><div><h2>Business claims</h2><p className={styles.muted}>One tap approves. Each business gets one owner, so the earliest claim wins.</p></div>
          {desk.claims.length ? <button type="button" className={styles.primary} onClick={() => void act({ action: "claims-approve", ids: "all" }, approved)}>Approve all ({desk.claims.length})</button> : null}</div>
        {desk.claims.length === 0 ? <p className={styles.empty}>No claims waiting.</p> : desk.claims.map((claim) => (
          <div key={claim.id} className={styles.item}>
            <div className={styles.itemText}><b>{claim.business}{claim.city ? `, ${claim.city}` : ""}</b><span>{claim.applicant} · {claim.role} · {claim.phone}</span><span>Number on the listing: {claim.listed_phone ?? "none"}{claim.notes ? ` · "${claim.notes}"` : ""}</span>{claim.has_owner ? <span className={styles.tags}><span className={styles.tag}>Already has an owner</span></span> : null}</div>
            <div className={styles.itemActions}><button type="button" className={styles.primarySmall} onClick={() => void act({ action: "claims-approve", ids: [claim.id] }, approved)}>Approve</button><button type="button" className={styles.linkBtn} onClick={() => void act({ action: "claim-reject", id: claim.id })}>Reject</button></div>
          </div>
        ))}
      </section>
      <section className={styles.panel}>
        <h2>Payments to confirm</h2>
        <p className={styles.muted}>Check the money has arrived first. Confirming switches on what they bought and records the agent&apos;s commission.</p>
        {desk.payments.length === 0 ? <p className={styles.empty}>No payments waiting.</p> : desk.payments.map((payment) => (
          <div key={payment.id} className={styles.item}>
            <div className={styles.itemText}><b>{payment.business}</b><span>{PRODUCT_LABEL[payment.product] ?? payment.product} · {payment.method} · {payment.ref}</span><span>{payment.agent ? `Agent: ${payment.agent}` : "No agent"}</span></div>
            <div className={styles.itemActions}>
              <label className={styles.field}>Amount received<input inputMode="decimal" style={{ width: 90 }} value={amounts[payment.id] ?? String(payment.amount ?? "")} onChange={(event) => setAmounts({ ...amounts, [payment.id]: event.target.value })} /></label>
              <button type="button" className={styles.primarySmall} onClick={() => void act<{ commission: number }>({ action: "payment", id: payment.id, decision: "confirm", amount: amounts[payment.id] ?? payment.amount }, (result) => `Confirmed. Commission recorded: ${usd(result.commission)}.`)}>Confirm</button>
              <button type="button" className={styles.secondary} onClick={() => void act({ action: "payment", id: payment.id, decision: "reject" })}>Not received</button>
            </div>
          </div>
        ))}
      </section>
      <section className={styles.panel}>
        <h2>Digital Package chats</h2>
        {desk.deals.length === 0 ? <p className={styles.empty}>No open chats.</p> : desk.deals.map((deal) => (
          <div key={deal.id}>
            <div className={styles.item}>
              <div className={styles.itemText}><b>{deal.business}</b><span>{[deal.contact, deal.phone, deal.agent ? `Agent: ${deal.agent}` : "No agent yet"].filter(Boolean).join(" · ")}</span><span>{deal.last_text}</span><span className={styles.tags}>{deal.unread ? <span className={styles.tag}>New message</span> : null}<span className={styles.tag}>{deal.package}</span><span className={styles.tag}>{deal.stage}</span>{deal.quoted ? <span className={styles.tag}>{usd(deal.quoted)}</span> : null}</span></div>
              <div className={styles.itemActions}><button type="button" className={styles.primarySmall} onClick={() => setOpen(open === deal.id ? null : deal.id)}>{open === deal.id ? "Close" : "Open chat"}</button></div>
            </div>
            {open === deal.id ? <DealTools api={api} deal={deal} agents={desk.agents} act={act} /> : null}
          </div>
        ))}
      </section>
    </>
  );
}

function DealTools({ api, deal, agents, act }: { api: Api; deal: OpenDeal; agents: AgentRow[]; act: Act }) {
  const [quote, setQuote] = useState(deal.quoted ? String(deal.quoted) : "");
  const [paid, setPaid] = useState({ amount: "", method: "EcoCash", ref: "" });
  const read = useCallback(() => api<Deal>(`${PATH}?view=room&deal=${deal.id}`), [api, deal.id]);
  const send = useCallback(async (body: string) => { await api(PATH, post({ action: "deal-post", deal: deal.id, body })); }, [api, deal.id]);
  return (
    <div className={styles.note}>
      <DealRoom read={read} send={send} />
      <div className={styles.row} style={{ marginTop: 12 }}>
        <label className={styles.field}>Agent<select value={deal.agent_id ?? ""} onChange={(event) => void act({ action: "deal", id: deal.id, agent: event.target.value })}><option value="">None</option>{agents.filter((agent) => agent.active).map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label>
        <label className={styles.field}>Stage<select value={deal.stage} onChange={(event) => void act({ action: "deal", id: deal.id, stage: event.target.value })}>{["new", "talking", "quoted", "lost"].map((stage) => <option key={stage}>{stage}</option>)}</select></label>
        <label className={styles.field}>Agreed price ($)<input inputMode="decimal" value={quote} onChange={(event) => setQuote(event.target.value)} onBlur={() => { if (quote) void act({ action: "deal", id: deal.id, quoted: quote, stage: "quoted" }); }} /></label>
      </div>
      <div className={styles.row}>
        <label className={styles.field}>Paid ($)<input inputMode="decimal" value={paid.amount} onChange={(event) => setPaid({ ...paid, amount: event.target.value })} /></label>
        <label className={styles.field}>How<select value={paid.method} onChange={(event) => setPaid({ ...paid, method: event.target.value })}>{["EcoCash", "InnBucks", "OneMoney", "Bank transfer", "Cash"].map((method) => <option key={method}>{method}</option>)}</select></label>
        <label className={styles.field}>Reference<input value={paid.ref} onChange={(event) => setPaid({ ...paid, ref: event.target.value })} /></label>
        <button type="button" className={styles.primarySmall} disabled={!paid.amount} onClick={() => void act<{ commission: number }>({ action: "payment-record", deal: deal.id, product: deal.package === "website" ? "website" : "other", note: deal.package, ...paid }, (result) => `Sale recorded. Commission: ${usd(result.commission)}.`)}>Record payment</button>
      </div>
    </div>
  );
}

type CreditUse = {
  totals: { free: number; bought: number; spent: number; remaining: number };
  uses: { use: string; tokens: number; times: number }[];
  businesses: { business: string; free: number; bought: number; spent: number; remaining: number; last_used: string | null; top_use: string | null }[];
  customers: { reason: string; times: number; credits: number }[];
};

const USE_NAMES: Record<string, string> = {
  report: "Business reports",
  market: "Market checks",
  reply: "Review replies written by Benita",
  ask: "Questions to Benita",
  post: "Posts written by Benita",
  "auto draft": "Automatic reply drafts",
  "auto post": "Automatic replies posted",
};

const CUSTOMER_NAMES: Record<string, string> = {
  welcome: "Free welcome credits",
  review: "Earned for reviews",
  add_business: "Earned for adding a business",
  listing: "Earned for listings",
  deep_question: "Spent on deep questions",
  admin_adjustment: "Changed by you",
};

/** What businesses and WhatsApp users actually use credits on. */
function CreditsView({ api }: { api: Api }) {
  const [data, setData] = useState<CreditUse | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<CreditUse>(`${PATH}?view=credits`).then(setData).catch((failure) => setError(failure instanceof Error ? failure.message : "Credit use could not be loaded."));
  }, [api]);
  if (error) return <p className={styles.error} role="alert">{error}</p>;
  if (!data) return <p className={styles.muted}>Loading…</p>;
  const name = (use: string | null) => (use ? USE_NAMES[use] ?? use : "Nothing yet");
  return (
    <>
      <section className={styles.panel}>
        <h2>Business credits</h2>
        <p className={styles.muted}>{data.totals.free} given free · {data.totals.bought} bought · {data.totals.spent} used · {data.totals.remaining} left</p>
        <h3>What they use them on</h3>
        {data.uses.length === 0 ? <p className={styles.empty}>No business has used a credit yet.</p> : data.uses.map((item) => (
          <div key={item.use} className={styles.item}><div className={styles.itemText}><b>{name(item.use)}</b><span>{item.times} {item.times === 1 ? "time" : "times"} · {item.tokens} credits</span></div></div>
        ))}
      </section>
      <section className={styles.panel}>
        <h2>By business</h2>
        {data.businesses.length === 0 ? <p className={styles.empty}>No businesses have credits yet.</p> : data.businesses.map((item) => (
          <div key={item.business} className={styles.item}><div className={styles.itemText}><b>{item.business}</b><span>{item.remaining} left · {item.spent} used · {item.bought} bought · {item.free} free</span><span>Uses most: {name(item.top_use)}</span></div></div>
        ))}
      </section>
      <section className={styles.panel}>
        <h2>WhatsApp customers&apos; credits</h2>
        <p className={styles.muted}>Separate from business credits.</p>
        {data.customers.map((item) => (
          <div key={item.reason} className={styles.item}><div className={styles.itemText}><b>{CUSTOMER_NAMES[item.reason] ?? item.reason}</b><span>{item.times} {item.times === 1 ? "time" : "times"} · {item.credits > 0 ? "+" : ""}{item.credits} credits</span></div></div>
        ))}
      </section>
    </>
  );
}

function RevenueView({ api, desk, act }: { api: Api; desk: Desk; act: Act }) {
  const [period, setPeriod] = useState("30");
  const [dates, setDates] = useState({ from: "", to: "" });
  const [agent, setAgent] = useState("");
  const [product, setProduct] = useState("");
  const [city, setCity] = useState("");
  const [data, setData] = useState<Revenue | null>(null);
  const [form, setForm] = useState({ business: "", product: "website", amount: "", method: "Cash", ref: "", agent: "" });
  const [error, setError] = useState<string | null>(null);
  const url = useMemo(() => {
    const query = new URLSearchParams({ view: "revenue" });
    const now = new Date();
    if (period === "7" || period === "30") query.set("from", new Date(now.getTime() - Number(period) * 864e5).toISOString());
    if (period === "month") query.set("from", new Date(now.getFullYear(), now.getMonth(), 1).toISOString());
    if (period === "custom") { if (dates.from) query.set("from", dates.from); if (dates.to) query.set("to", new Date(new Date(dates.to).getTime() + 864e5).toISOString()); }
    if (agent) query.set("agent", agent); if (product) query.set("product", product); if (city) query.set("city", city);
    return `${PATH}?${query}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `now` only anchors the chosen period
  }, [period, dates, agent, product, city]);
  const load = useCallback(async () => { try { setData(await api<Revenue>(url)); setError(null); } catch (failure) { setError(failure instanceof Error ? failure.message : "Revenue could not be loaded."); } }, [api, url]);
  useEffect(() => { void load(); }, [load]);
  const owedIds = (agentId: number | null) => (data?.rows ?? []).filter((row) => row.commission_status === "owed" && row.commission_id && desk.agents.find((item) => item.name === row.agent)?.id === agentId).map((row) => row.commission_id);
  async function payAgent(agentId: number | null, name: string) { const ref = window.prompt(`Payment reference for ${name}'s commission (optional)`); if (ref === null) return; if (await act({ action: "commissions-pay", ids: owedIds(agentId), ref })) void load(); }
  async function undo(id: string) { if (window.confirm("Undo this payment? Tokens are taken back and unpaid commission is cancelled. A plan stays on until its date.")) { if (await act<{ warning: string | null }>({ action: "payment", id, decision: "undo" }, (result) => result.warning ?? "Payment undone.")) void load(); } }
  async function record() { if (await act<{ commission: number }>({ action: "payment-record", ...form }, (result) => `Recorded. Commission: ${usd(result.commission)}.`)) { setForm({ ...form, business: "", amount: "", ref: "" }); void load(); } }
  function exportCsv() {
    const rows = [["Date", "Business", "City", "Product", "Amount", "Method", "Reference", "Agent", "Commission", "Commission status"], ...(data?.rows ?? []).map((row) => [row.at.slice(0, 10), row.business, row.city ?? "", PRODUCT_LABEL[row.product] ?? row.product, row.amount, row.method ?? "", row.ref ?? "", row.agent ?? "", row.commission ?? 0, row.commission_status ?? ""])];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""').replace(/^([=+\-@])/, "'$1")}"`).join(",")).join("\n");
    const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); link.download = "trusthub-revenue.csv"; link.click(); URL.revokeObjectURL(link.href);
  }
  const kpis: [string, number, string][] = data ? [["Revenue", data.totals.revenue, `${data.totals.sales} sale${data.totals.sales === 1 ? "" : "s"}`], ["Commission owed", data.totals.commission_owed, "still to pay agents"], ["Commission paid", data.totals.commission_paid, "already paid"], ["You keep", data.totals.net, "revenue less commission"]] : [];
  return (
    <>
      <section className={styles.panel}>
        <div className={styles.row}>
          <label className={styles.field}>Period<select value={period} onChange={(event) => setPeriod(event.target.value)}>{PERIODS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          {period === "custom" ? <><label className={styles.field}>From<input type="date" value={dates.from} onChange={(event) => setDates({ ...dates, from: event.target.value })} /></label><label className={styles.field}>To<input type="date" value={dates.to} onChange={(event) => setDates({ ...dates, to: event.target.value })} /></label></> : null}
          <label className={styles.field}>Agent<select value={agent} onChange={(event) => setAgent(event.target.value)}><option value="">All agents</option>{desk.agents.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label className={styles.field}>Product<select value={product} onChange={(event) => setProduct(event.target.value)}><option value="">Everything</option>{Object.entries(PRODUCT_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <label className={styles.field}>City<select value={city} onChange={(event) => setCity(event.target.value)}><option value="">All cities</option>{(data?.cities ?? []).map((item) => <option key={item}>{item}</option>)}</select></label>
        </div>
      </section>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      <div className={styles.kpis}>{kpis.map(([label, value, hint]) => <div key={label} className={styles.kpi}><span className={styles.kpiLabel}>{label}</span><span className={styles.kpiValue}>{usd(value)}</span><span className={styles.kpiNote}>{hint}</span></div>)}</div>
      <section className={styles.panel}>
        <h2>By agent</h2>
        {data?.by_agent.length ? <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Agent</th><th>Sales</th><th>Revenue</th><th>Owed</th><th>Paid</th><th><span className={styles.srOnly}>Actions</span></th></tr></thead><tbody>
          {data.by_agent.map((row) => <tr key={row.agent}><td>{row.agent}</td><td>{row.sales}</td><td>{usd(row.revenue)}</td><td>{usd(row.owed)}</td><td>{usd(row.paid)}</td><td>{row.agent_id && Number(row.owed) > 0 ? <button type="button" className={styles.linkBtn} onClick={() => void payAgent(row.agent_id, row.agent)}>Mark paid</button> : null}</td></tr>)}
        </tbody></table></div> : <p className={styles.empty}>No sales in this period yet.</p>}
      </section>
      <section className={styles.panel}>
        <div className={styles.head}><h2>Every sale</h2>{data?.rows.length ? <button type="button" className={styles.secondary} onClick={exportCsv}>Export CSV</button> : null}</div>
        {data?.rows.length ? <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Date</th><th>Business</th><th>Product</th><th>Amount</th><th>Agent</th><th>Commission</th><th><span className={styles.srOnly}>Actions</span></th></tr></thead><tbody>
          {data.rows.map((row) => <tr key={row.id}><td>{new Date(row.at).toLocaleDateString("en-GB")}</td><td>{row.business}<div className={styles.small}>{[row.city, row.method, row.ref].filter(Boolean).join(" · ")}</div></td><td>{PRODUCT_LABEL[row.product] ?? row.product}</td><td>{usd(row.amount)}</td><td>{row.agent ?? "Direct"}</td><td>{row.commission ? `${usd(row.commission)} ${row.commission_status}` : "None"}</td><td><button type="button" className={styles.linkBtn} onClick={() => void undo(row.id)}>Undo</button></td></tr>)}
        </tbody></table></div> : <p className={styles.empty}>Nothing to show.</p>}
      </section>
      <section className={styles.panel}>
        <h2>Record a sale by hand</h2>
        <p className={styles.muted}>For cash or a deal made outside the app.</p>
        <div className={styles.row}>
          <label className={styles.field}>Business<input value={form.business} maxLength={120} onChange={(event) => setForm({ ...form, business: event.target.value })} /></label>
          <label className={styles.field}>Product<select value={form.product} onChange={(event) => setForm({ ...form, product: event.target.value })}><option value="website">Website</option><option value="other">Other digital product</option></select></label>
          <label className={styles.field}>Amount ($)<input inputMode="decimal" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} /></label>
          <label className={styles.field}>Agent<select value={form.agent} onChange={(event) => setForm({ ...form, agent: event.target.value })}><option value="">No agent</option>{desk.agents.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label className={styles.field}>How<input value={form.method} maxLength={40} onChange={(event) => setForm({ ...form, method: event.target.value })} /></label>
          <label className={styles.field}>Reference<input value={form.ref} maxLength={120} onChange={(event) => setForm({ ...form, ref: event.target.value })} /></label>
        </div>
        <button type="button" className={styles.primary} disabled={!form.business || !form.amount} onClick={() => void record()}>Record sale</button>
      </section>
    </>
  );
}

function Network({ desk, act }: { desk: Desk; act: Act }) {
  const [settings, setSettings] = useState(desk.settings);
  const save = (key: string) => void act({ action: "setting", key, value: settings[key] ?? "" }, () => "Saved.");
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return (
    <>
      <section className={styles.panel}>
        <h2>Your settings</h2>
        <div className={styles.row}>
          <label className={styles.field}>Your WhatsApp number<input value={settings.ceo_whatsapp ?? ""} placeholder="263771234567" maxLength={20} onChange={(event) => setSettings({ ...settings, ceo_whatsapp: event.target.value })} onBlur={() => save("ceo_whatsapp")} /></label>
          <label className={styles.field}>Agent commission (0.10 = 10%)<input value={settings.commission_rate ?? ""} maxLength={6} onChange={(event) => setSettings({ ...settings, commission_rate: event.target.value })} onBlur={() => save("commission_rate")} /></label>
          <label className={styles.field}>Website &quot;from&quot; price ($)<input value={settings.website_from_usd ?? ""} maxLength={6} onChange={(event) => setSettings({ ...settings, website_from_usd: event.target.value })} onBlur={() => save("website_from_usd")} /></label>
        </div>
        <p className={styles.muted}>Until your number is set, people chat in the app and the WhatsApp buttons stay hidden.</p>
      </section>
      <section className={styles.panel}>
        <h2>Give review cards to agents</h2>
        <p className={styles.muted}>The agent sees the card on their page with a free sheet to print and photocopy. A business on an agent&apos;s card joins their network.</p>
        {desk.cards.map((card) => <div key={card.id} className={styles.item}><div className={styles.itemText}><b>{card.code}</b><span>{card.business ?? "No business yet"}</span></div><div className={styles.itemActions}><a className={styles.linkBtn} href={`/cards/${card.code}/sheet`} target="_blank" rel="noreferrer">Print sheet</a><select aria-label={`Agent for ${card.code}`} value={card.agent_id ?? ""} onChange={(event) => { if (event.target.value) void act({ action: "card-agent", card: card.id, agent: event.target.value }, () => "Card given to the agent."); }}><option value="">No agent</option>{desk.agents.filter((agent) => agent.active).map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></div></div>)}
      </section>
      <section className={styles.panel}>
        <h2>Your pages</h2>
        <p className={styles.muted}>Digital Package: {origin}/digital</p>
        <p className={styles.muted}>Business sign-in: {origin}/business</p>
        <p className={styles.muted}>Sample to show owners: {origin}/business?sample=1</p>
      </section>
    </>
  );
}
