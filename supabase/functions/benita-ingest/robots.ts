/** robots.txt handling: cached per host for a day, longest-match rules for our agent or "*". */
import { rest } from "./db.ts";
import { USER_AGENT } from "./normalise.ts";

interface Rules { allow: string[]; disallow: string[]; delayMs: number; sitemaps: string[] }

function parse(body: string): Rules {
  const groups: { agents: string[]; allow: string[]; disallow: string[]; delay: number | null }[] = [];
  const sitemaps: string[] = [];
  let current: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, "").trim();
    const match = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!match) continue;
    const field = match[1].toLowerCase(), value = match[2].trim();
    if (field === "sitemap") { sitemaps.push(value); continue; }
    if (field === "user-agent") {
      if (!current || !lastWasAgent) { current = { agents: [], allow: [], disallow: [], delay: null }; groups.push(current); }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (field === "allow" && value) current.allow.push(value);
    if (field === "disallow" && value) current.disallow.push(value);
    if (field === "crawl-delay") current.delay = Number(value) || null;
  }
  const mine = groups.find((group) => group.agents.some((agent) => agent === "benitabot"))
    ?? groups.find((group) => group.agents.includes("*"));
  return { allow: mine?.allow ?? [], disallow: mine?.disallow ?? [], delayMs: Math.min(Math.max((mine?.delay ?? 2) * 1000, 1500), 15000), sitemaps };
}

function pattern(rule: string): RegExp {
  const escaped = rule.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp("^" + (escaped.endsWith("\\$") ? escaped.slice(0, -2) + "$" : escaped));
}

const memo = new Map<string, Rules>();

export async function robotsFor(url: string): Promise<Rules> {
  const { origin, host } = new URL(url);
  if (memo.has(host)) return memo.get(host)!;
  const cached = await rest<{ body: string | null; status: number; fetched_at: string }[]>(`benita_robots?host=eq.${encodeURIComponent(host)}&select=body,status,fetched_at`);
  let body = "", status = 0;
  if (cached.length && Date.now() - Date.parse(cached[0].fetched_at) < 86_400_000) ({ body, status } = { body: cached[0].body ?? "", status: cached[0].status });
  else {
    try {
      const response = await fetch(`${origin}/robots.txt`, { headers: { "user-agent": USER_AGENT }, redirect: "follow" });
      status = response.status;
      body = response.ok ? (await response.text()).slice(0, 200_000) : "";
    } catch { status = 0; }
    await rest("benita_robots?on_conflict=host", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: JSON.stringify({ host, body, status, fetched_at: new Date().toISOString() }) });
  }
  // A robots.txt that errors on the server side means "do not crawl"; a missing one (4xx) means everything is allowed.
  const rules = status >= 500 || status === 0 ? { allow: [], disallow: ["/"], delayMs: 5000, sitemaps: [] } : parse(body);
  memo.set(host, rules);
  return rules;
}

export function allowed(url: string, rules: Rules): boolean {
  const { pathname, search } = new URL(url);
  const path = pathname + search;
  let best = { length: -1, allow: true };
  for (const rule of rules.allow) if (pattern(rule).test(path) && rule.length > best.length) best = { length: rule.length, allow: true };
  for (const rule of rules.disallow) if (pattern(rule).test(path) && rule.length > best.length) best = { length: rule.length, allow: false };
  return best.allow;
}
