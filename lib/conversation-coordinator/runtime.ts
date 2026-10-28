import { createTrustHubAnswerResolver } from "../answer-resolution/factory.ts";
import type { TrustHubClient } from "../trusthub/client";
import { ConversationCoordinator, type CityValidator, type CoordinatorConnectOptions } from "./coordinator.ts";
import { InMemoryRuntimeConversationRepository } from "./repository.ts";
import type { RuntimeConversationRepository } from "./repository";
import type { AnswerGenerator } from "@/types/answer";
import type { IncomingTurn } from "./types";
import type { KnowledgeRecordReader } from "../discovery/service";
import type { DeclaredContributionReader } from "../answer-resolution/contributions-source.ts";
import type { IdentityProvisioner } from "../identity/provisioner.ts";

export interface ConversationRuntimeOptions {
  trustHubClient: Pick<TrustHubClient, "searchBusinesses" | "listCommunitiesByLocation">;
  repository?: RuntimeConversationRepository;
  now?: () => string;
  knowledgeRecordReader?: KnowledgeRecordReader;
  /** Optional declared-contribution read. Omit it and the resolver records the community source as unavailable, exactly as before. */
  contributionReader?: DeclaredContributionReader;
  /** Optional presenter for sourced results; the deterministic generator is used when omitted. */
  answerGenerator?: AnswerGenerator;
  /** Optional profile-creation seam. Omit it and an explicit "create my profile" request throws. */
  provisioner?: IdentityProvisioner;
  /** The guided Connect journeys and their store. Omit it and an in-memory store is used (tests, local harness). */
  connect?: CoordinatorConnectOptions;
}

/** Local composition seam: coordinator and resolver remain separately replaceable modules. */
export function createConversationRuntime(options: ConversationRuntimeOptions) {
  const now = options.now ?? (() => new Date().toISOString());
  const repository = options.repository ?? new InMemoryRuntimeConversationRepository();
  const resolver = createTrustHubAnswerResolver(options.trustHubClient, now, options.knowledgeRecordReader, options.contributionReader);
  const cityValidator: CityValidator = async (city, country) => {
    const wanted = city.trim().toLocaleLowerCase();
    try {
      if ((await options.trustHubClient.listCommunitiesByLocation(country, city)).some((community) => community.city.trim().toLocaleLowerCase() === wanted)) return true;
    } catch { /* fall through to the business records */ }
    // A city with TrustHub businesses is a real location even before it has a community row.
    try {
      const listed = await options.trustHubClient.searchBusinesses({ text: city, intent: null, category: null, location: { country, city }, questionType: "business_discovery" });
      return listed.some((business) => (business.city ?? "").trim().toLocaleLowerCase() === wanted);
    } catch { return false; }
  };
  const coordinator = new ConversationCoordinator(repository, resolver, now, options.answerGenerator, undefined, cityValidator, options.provisioner, options.connect);
  return { coordinator, resolver, repository, handleTurn: (turn: IncomingTurn) => coordinator.handleTurn(turn) };
}
