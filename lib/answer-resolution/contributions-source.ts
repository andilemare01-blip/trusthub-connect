import type { TrustHubClient } from "../trusthub/client.ts";
import type { DeclaredContributionQuery, DeclaredContributionRecord } from "../contributions/repository.ts";
import type { AnswerSource, AnswerSourceResult, EvidenceItem, NormalizedRequest } from "./types.ts";

/** Read port for persisted, declared-only community contributions. */
export interface DeclaredContributionReader {
  findDeclaredByCommunity(query: DeclaredContributionQuery): Promise<DeclaredContributionRecord[]>;
}

export type CommunityIdResolver = (request: NormalizedRequest) => Promise<string | null>;

/**
 * Resolves the request's community using the same exact city/country match the
 * persistent turn entry point already applies. An unknown or ambiguous location
 * resolves to no community rather than guessing one, so a contribution can never
 * leak across a community boundary.
 */
export function createListCommunityIdResolver(client: Pick<TrustHubClient, "listCommunitiesByLocation">): CommunityIdResolver {
  return async (request) => {
    const city = request.location?.city?.trim();
    if (!city) return null;
    const country = request.location?.country?.trim() || null;
    const communities = await client.listCommunitiesByLocation(country, city);
    const exact = communities.filter((community) => community.city.trim().toLocaleLowerCase() === city.toLocaleLowerCase()
      && (!country || community.country.trim().toLocaleLowerCase() === country.toLocaleLowerCase()));
    return exact.length === 1 ? exact[0].id : null;
  };
}

/**
 * Adapts a stored community claim into resolver evidence. The claim is quoted
 * as the member's own unverified words; `verificationStatus` is hard-coded to
 * `declared` rather than read from the row, so this source can never promote
 * evidence no matter what the database contains.
 */
export function contributionEvidence(record: DeclaredContributionRecord, retrievedAt: string): EvidenceItem {
  const subject = record.providerName
    ? `${record.category ?? "a service"} (${record.providerName})`
    : record.category ?? "a service";
  const claim = `A TrustHub community member shared this about ${subject}${record.area ? ` in ${record.area}` : ""}, unverified: "${record.claim}"`;
  const provenanceDetails = [
    `contribution_id:${record.id}`,
    `community_id:${record.communityId}`,
    record.area ? `area:${record.area}` : null,
    record.source ? `source:${record.source}` : null,
    record.relationship ? `relationship:${record.relationship}` : null,
    record.sourceMessageId ? `source_message_id:${record.sourceMessageId}` : null,
    record.evidenceNotes ? `evidence_notes:${record.evidenceNotes}` : null,
  ].filter((item): item is string => !!item);
  return {
    id: `contribution:${record.id}`,
    claim,
    source: "community",
    sourceLabel: `TrustHub community contribution${record.providerName ? ` for ${record.providerName}` : ""}`,
    verificationStatus: "declared",
    confidence: "low",
    retrievedAt,
    sourceRecordId: record.id,
    completeness: "partial",
    recordSource: record.source,
    recordSourceId: record.sourceMessageId,
    provenanceDetails,
  };
}

/**
 * Serves persisted community contributions to the resolver's existing
 * `community` source, which is already consent-gated and already forces
 * `declared` status. Registering it is the only wiring change: approved
 * `knowledge_records` still resolve first and outrank this evidence.
 */
export class ContributionsAnswerSource implements AnswerSource {
  private readonly reader: DeclaredContributionReader;
  private readonly communityId: CommunityIdResolver;
  private readonly now: () => string;

  constructor(reader: DeclaredContributionReader, communityId: CommunityIdResolver, now: () => string = () => new Date().toISOString()) {
    this.reader = reader;
    this.communityId = communityId;
    this.now = now;
  }

  async search(request: NormalizedRequest): Promise<AnswerSourceResult> {
    const communityId = await this.communityId(request);
    if (!communityId) {
      return { matchStatus: "none", evidence: [], availability: "unavailable", sourceNotes: ["No single canonical community matches the requested city."] };
    }
    const records = await this.reader.findDeclaredByCommunity({
      communityId,
      area: request.location?.area ?? null,
      category: request.category ?? null,
    });
    const retrievedAt = this.now();
    const evidence = records
      .filter((record) => record.claim.trim().length > 0)
      .map((record) => contributionEvidence(record, retrievedAt));
    return {
      matchStatus: evidence.length > 1 ? "multiple" : evidence.length ? "matched" : "none",
      evidence,
      availability: "available",
      ...(evidence.length ? { sourceNotes: ["Community contributions are member-declared and unverified."] } : {}),
    };
  }
}
