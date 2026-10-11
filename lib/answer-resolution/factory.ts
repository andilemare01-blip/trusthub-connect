import { TrustHubBusinessAnswerSource } from "./trusthub-source.ts";
import { PolicyAnswerResolver } from "./resolver.ts";
import type { TrustHubClient } from "../trusthub/client";
import { TrustHubKnowledgeAnswerSource } from "./knowledge-source.ts";
import type { KnowledgeRecordReader } from "../discovery/service";
import { ContributionsAnswerSource, createListCommunityIdResolver, type DeclaredContributionReader } from "./contributions-source.ts";
import type { AnswerSource, SourceKind } from "./types.ts";

/** Resolver composition is credential-agnostic; server code supplies its read-only TrustHub client. */
export function createTrustHubAnswerResolver(
  client: Pick<TrustHubClient, "searchBusinesses" | "listCommunitiesByLocation">,
  now?: () => string,
  knowledge?: KnowledgeRecordReader,
  contributions?: DeclaredContributionReader,
): PolicyAnswerResolver {
  const sources: Partial<Record<SourceKind, AnswerSource>> = {
    trusthub: knowledge ? new TrustHubKnowledgeAnswerSource(client, knowledge, now) : new TrustHubBusinessAnswerSource(client, now),
  };
  // Registered only when a contribution reader is supplied, so the unconnected
  // case is unchanged: the resolver still records `community` as unavailable.
  // It is a separate source, never merged into `trusthub`, so approved
  // knowledge_records keep resolving first and keep their existing trust
  // semantics.
  if (contributions) sources.community = new ContributionsAnswerSource(contributions, createListCommunityIdResolver(client), now);
  return new PolicyAnswerResolver(sources);
}
