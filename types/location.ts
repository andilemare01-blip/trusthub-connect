/**
 * Location hierarchy types for TrustHub Connect.
 *
 * PRESERVES country → city → area (do not simplify to country+city).
 * `area` is always optional: a person or business may participate at
 * city/community level with area unknown, and gain finer intelligence once
 * area becomes known. NOT a confirmed database schema — see
 * TRUSTHUB_CONNECT_ARCHITECTURE_PLAN.md Section 5 and
 * IMPLEMENTATION_PREREQUISITES.md item 7 (the live `communities` table's
 * exact schema is still unverified).
 */

export type LocationConfidence =
  /** Explicitly confirmed by the person (e.g. selected from a list). */
  | "user_confirmed"
  /** Derived from device GPS/geolocation, with consent. */
  | "gps"
  /** Inferred from free text or other weak signals. */
  | "inferred"
  | "unknown";

/** A location scope that is always at least country-known, city optional, area optional. */
export interface LocationScope {
  country: string;
  city: string | null;
  area: string | null;
  confidence: LocationConfidence;
}

/** True once city-level participation is possible (area not required). */
export function hasCityLevelLocation(scope: LocationScope): boolean {
  return Boolean(scope.country && scope.city);
}

/** True once finer, area-level intelligence is possible. */
export function hasAreaLevelLocation(scope: LocationScope): boolean {
  return hasCityLevelLocation(scope) && Boolean(scope.area);
}
