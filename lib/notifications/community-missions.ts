/**
 * Community missions: occasional, personal invitations to share local knowledge. This module is pure policy and wording;
 * sending, storage and scheduling live in the cron route. Nothing here sends anything.
 */
export type PreferenceLevel = "off" | "reduced" | "on";

const OFF = /^(?:please\s+)?(?:stop|unsubscribe|opt\s*out)\.?$|\b(?:stop|pause|cancel)\s+(?:all\s+|the\s+|these\s+|your\s+)?(?:community\s+)?(?:messages|notifications|texts|questions)\b|\bno more (?:messages|notifications|community questions)\b|\bdon'?t (?:message|text|contact) me\b/i;
const REDUCED = /\b(?:fewer|less)\s+(?:messages|notifications|often)\b|\bmessage me less\b|\breduce (?:the )?(?:messages|notifications)\b/i;
const ON = /\b(?:send me|start|resume|turn on|enable)\s+(?:the\s+)?(?:community\s+)?(?:questions|messages|notifications|updates)\b|\bopt\s*in\b|\bi(?:'d| would)? (?:like|want) (?:to get )?community (?:questions|messages)\b/i;

/** Only explicit wording changes preferences; ordinary conversation never does. */
export function parseNotificationPreference(text: string): PreferenceLevel | null {
  const value = text.trim();
  if (!value || value.length > 120) return null;
  if (OFF.test(value)) return "off";
  if (REDUCED.test(value)) return "reduced";
  if (ON.test(value)) return "on";
  return null;
}

export function preferenceReply(level: PreferenceLevel): string {
  switch (level) {
    case "off": return "Done. I won't send you community questions any more. You can still ask me for help any time, and say *send me community questions* if you ever want them back.";
    case "reduced": return "Understood. I'll send community questions much less often. Say *stop messages* if you'd rather not get any.";
    case "on": return "Lovely. I'll occasionally ask you a quick question about local services, never more than a few a day and never late at night. Say *stop messages* any time and I'll stop.";
  }
}

export interface MissionPolicy {
  /** Messages per person per local day. Conservative default 1, hard ceiling 3. */
  maxPerDay: number;
  minSpacingHours: number;
  /** Quiet hours are outside [windowStartHour, windowEndHour) local time. */
  windowStartHour: number;
  windowEndHour: number;
  /** Local offset from UTC in hours (Harare is +2, no daylight saving). */
  utcOffsetHours: number;
  /** A person on the reduced setting is messaged at most once in this many days. */
  reducedIntervalDays: number;
  /** Free-form WhatsApp messages are only allowed shortly after the person last wrote. */
  serviceWindowHours: number;
}

export const HARD_MAX_PER_DAY = 3;

export function missionPolicy(overrides: Partial<MissionPolicy> = {}): MissionPolicy {
  const base: MissionPolicy = { maxPerDay: 1, minSpacingHours: 4, windowStartHour: 8, windowEndHour: 19, utcOffsetHours: 2, reducedIntervalDays: 3, serviceWindowHours: 23 };
  const merged = { ...base, ...overrides };
  merged.maxPerDay = Math.min(HARD_MAX_PER_DAY, Math.max(0, Math.floor(merged.maxPerDay)));
  return merged;
}

export function policyFromEnvironment(env: Record<string, string | undefined>): MissionPolicy {
  const number = (value: string | undefined) => { const parsed = Number(value); return value && Number.isFinite(parsed) ? parsed : undefined; };
  return missionPolicy({ maxPerDay: number(env.COMMUNITY_MISSIONS_MAX_PER_DAY) ?? 1 });
}

export type SkipReason = "not_opted_in" | "opted_out" | "outside_service_window" | "quiet_hours" | "daily_limit" | "spacing" | "reduced_interval" | "no_mission";

export interface EligibilityInput {
  preference: PreferenceLevel | null;
  /** Times earlier missions were sent to this person. */
  sentAt: number[];
  lastInboundAt: number | null;
  now: number;
  policy: MissionPolicy;
}

export function localDate(now: number, policy: MissionPolicy): string { return new Date(now + policy.utcOffsetHours * 3_600_000).toISOString().slice(0, 10); }
export function localHour(now: number, policy: MissionPolicy): number { return new Date(now + policy.utcOffsetHours * 3_600_000).getUTCHours(); }

/** Opt-in is required: with no recorded preference a person is never messaged. */
export function checkEligibility(input: EligibilityInput): { ok: true } | { ok: false; reason: SkipReason } {
  const { preference, sentAt, lastInboundAt, now, policy } = input;
  if (preference === "off") return { ok: false, reason: "opted_out" };
  if (preference !== "on" && preference !== "reduced") return { ok: false, reason: "not_opted_in" };
  if (lastInboundAt === null || now - lastInboundAt > policy.serviceWindowHours * 3_600_000) return { ok: false, reason: "outside_service_window" };
  const hour = localHour(now, policy);
  if (hour < policy.windowStartHour || hour >= policy.windowEndHour) return { ok: false, reason: "quiet_hours" };
  const today = localDate(now, policy);
  const sentToday = sentAt.filter((time) => localDate(time, policy) === today).length;
  const allowed = preference === "reduced" ? Math.min(1, policy.maxPerDay) : policy.maxPerDay;
  if (sentToday >= allowed) return { ok: false, reason: "daily_limit" };
  const latest = Math.max(0, ...sentAt);
  if (latest && now - latest < policy.minSpacingHours * 3_600_000) return { ok: false, reason: "spacing" };
  if (preference === "reduced" && latest && now - latest < policy.reducedIntervalDays * 86_400_000) return { ok: false, reason: "reduced_interval" };
  return { ok: true };
}

export interface MissionGap { category: string; city: string; requests: number; listed: number | null }
export interface Mission { key: string; category: string | null; city: string | null; message: string }

const clean = (value: string) => value.replace(/[^\p{L}\p{N} '&-]/gu, "").trim().slice(0, 50);
const STOP_LINE = "Reply STOP if you'd rather not get these.";

/**
 * Picks the most useful mission this person has not been asked recently. A gap is described only as far as the records
 * support it: "only N listed" appears when we counted N, otherwise the question is phrased without any claim.
 */
export function chooseMission(gaps: MissionGap[], alreadyAsked: Set<string>): Mission | null {
  const ranked = [...gaps].filter((gap) => clean(gap.category) && clean(gap.city) && (gap.listed === null || gap.listed < 3)).sort((a, b) => b.requests - a.requests || a.category.localeCompare(b.category));
  for (const gap of ranked) {
    const category = clean(gap.category).toLocaleLowerCase();
    const city = clean(gap.city);
    const key = `${category}|${city.toLocaleLowerCase()}`;
    if (alreadyAsked.has(key)) continue;
    const evidence = gap.listed !== null
      ? ` ${gap.listed === 0 ? `TrustHub doesn't have any listed for ${city} yet` : `TrustHub only has ${gap.listed} listed for ${city} so far`}, and people have been asking.`
      : ` People in ${city} have been asking about it.`;
    return {
      key, category, city,
      message: `Hey! Quick question for the ${city} community 😊 Do you know a ${category} you'd recommend?${evidence} Tell me their name and the area they serve, and I'll keep it labelled as community-shared until it can be checked. ${STOP_LINE}`,
    };
  }
  const generic = "general|any";
  if (alreadyAsked.has(generic)) return null;
  return {
    key: generic, category: null, city: null,
    message: `Hey! Quick question for the community 😊 Have you used a plumber, electrician or other service recently that you'd recommend people know about? Tell TrustHub who they are and which area they serve. I'll keep your information appropriately labelled until it can be checked. ${STOP_LINE}`,
  };
}

export function missionDedupeKey(identityId: string, now: number, policy: MissionPolicy, missionKey: string): string {
  return `mission:${identityId}:${localDate(now, policy)}:${missionKey}`;
}
