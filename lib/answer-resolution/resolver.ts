import type { AnswerSource, EvidenceItem, NormalizedRequest, ResolutionResult, ResolverContext, SourceAttempt, SourceKind } from "./types";

export interface AnswerResolver { resolve(request: NormalizedRequest, context?: ResolverContext): Promise<ResolutionResult>; }

function result(status: ResolutionResult["status"], evidence: EvidenceItem[], attempts: SourceAttempt[], nextAction: ResolutionResult["nextAction"], uncertainty: string | null, clarificationQuestion?: string, communityLookup?: ResolutionResult["communityLookup"]): ResolutionResult {
  const confidence = evidence.length === 0 ? "unknown" : evidence.some((item) => item.confidence === "low" || item.confidence === "unknown") ? "low" : evidence.some((item) => item.confidence === "medium") ? "medium" : "high";
  return { status, evidence, provenance: [...new Set(evidence.map((item) => item.source))], confidence, uncertainty, sourceAttempts: attempts, nextAction, ...(clarificationQuestion ? { clarificationQuestion } : {}), ...(communityLookup ? { communityLookup } : {}) };
}

function sourcesFor(request: NormalizedRequest): SourceKind[] {
  switch (request.questionType) {
    case "business_discovery": return ["trusthub", "community", "overture", "openstreetmap", "google_places"];
    case "provider_recommendation": return ["trusthub", "community", "human_trust_agent"];
    case "business_fact": return ["trusthub", "community", "overture", "openstreetmap"];
    case "reputation": return ["trusthub", "community", "human_trust_agent"];
    case "community_question": return ["trusthub", "community", "human_trust_agent"];
    case "trusthub_policy": return ["authored", "human_trust_agent"];
    case "add_business": return ["authored"];
    case "review_write": return ["authored"];
    case "general": return ["ai"];
    default: return ["trusthub", "community", "human_trust_agent"];
  }
}

export class PolicyAnswerResolver implements AnswerResolver {
  private readonly sources: Partial<Record<SourceKind, AnswerSource>>;

  constructor(sources: Partial<Record<SourceKind, AnswerSource>>) { this.sources = sources; }

  async resolve(request: NormalizedRequest, context: ResolverContext = {}): Promise<ResolutionResult> {
    if ((request.questionType === "business_discovery" || request.questionType === "provider_recommendation") && !request.category) {
      return result("clarification_needed", [], [], "clarify", "The service or category is not clear enough to search.", request.ambiguity?.question ?? "What type of business or service are you looking for?");
    }
    if (request.questionType === "business_fact" && !request.entityName && !request.category) {
      return result("clarification_needed", [], [], "clarify", "The business to look up is not identified.", "Which business are you asking about?");
    }
    if ((request.questionType === "business_discovery" || request.questionType === "provider_recommendation" || request.questionType === "business_fact") && !request.location?.city && !context.clarificationAsked) {
      return result("clarification_needed", [], [], "clarify", "A city is needed to scope this local search.", "Which city should I look in? An area is optional.");
    }

    const attempts: SourceAttempt[] = [];
    const evidence: EvidenceItem[] = [];
    let communityLookup: ResolutionResult["communityLookup"];
    let partialMatch = false;
    for (const source of sourcesFor(request)) {
      if (source === "community") {
        if (context.requesterConsentedToCommunity === false) { attempts.push({ source, status: "declined" }); continue; }
        if (context.requesterConsentedToCommunity !== true) { attempts.push({ source, status: "skipped", note: "Requester consent not recorded" }); continue; }
        if (context.communityAvailable === false) { attempts.push({ source, status: "unavailable" }); continue; }
      }
      if (source === "human_trust_agent") {
        if (context.requesterConsentedToHuman !== true) { attempts.push({ source, status: context.requesterConsentedToHuman === false ? "declined" : "skipped", note: "Human handoff requires consent" }); continue; }
        if (context.trustAgentAvailability !== "available") { attempts.push({ source, status: "unavailable", note: "Trust Agent availability is not confirmed" }); continue; }
      }
      if (["overture", "openstreetmap", "google_places"].includes(source)) {
        if (!context.externalDiscoveryEnabled || (context.externalSources && !context.externalSources.includes(source))) { attempts.push({ source, status: "skipped", note: "External discovery is not enabled" }); continue; }
      }
      const adapter = this.sources[source];
      if (!adapter) { attempts.push({ source, status: "unavailable" }); continue; }
      try {
        const sourceResult = await adapter.search(request);
        communityLookup = sourceResult.communityLookup ?? communityLookup;
        const found = sourceResult.evidence;
        partialMatch ||= sourceResult.matchStatus === "partial";
        const availability = sourceResult.availability ?? "available";
        const attemptStatus = found.length ? "checked" : availability === "available" ? "empty" : "unavailable";
        attempts.push({ source, status: attemptStatus, ...(sourceResult.sourceNotes?.length ? { note: sourceResult.sourceNotes.join("; ") } : {}) });
        const constrained = found.map((item) => {
          if (["overture", "openstreetmap", "google_places"].includes(source)) return { ...item, source, verificationStatus: "potential" as const, confidence: item.confidence === "high" ? "medium" as const : item.confidence };
          if (source === "community" || source === "human_trust_agent") return { ...item, source, verificationStatus: "declared" as const };
          return { ...item, source };
        });
        evidence.push(...constrained);
        if (source === "trusthub" && sourceResult.matchStatus === "multiple" && request.questionType === "business_fact") {
          return result("clarification_needed", evidence, attempts, "clarify", "More than one TrustHub record matches the requested business.", sourceResult.clarificationQuestion ?? "I found more than one matching business. Which one do you mean?", communityLookup);
        }
        if (found.length && (source === "authored" || source === "ai" || (source === "trusthub" && request.questionType !== "provider_recommendation"))) break;
        if (found.length && source === "community") break;
      } catch (error) {
        const note = error instanceof Error && error.name === "SupabaseConfigurationError" ? error.message : undefined;
        attempts.push({ source, status: "unavailable", ...(note ? { note } : {}) });
      }
    }
    if (request.questionType === "provider_recommendation" && evidence.some((item) => item.source === "trusthub") && !evidence.some((item) => item.source === "community")) {
      if (attempts.some((item) => item.source === "community" && item.status === "skipped")) {
      return result("community_needed", evidence, attempts, "ask_community_permission", "TrustHub has listings, but no community experience has been gathered to support a recommendation.", undefined, communityLookup);
      }
      if (attempts.some((item) => item.source === "human_trust_agent" && item.status === "skipped")) {
        return result("human_needed", evidence, attempts, "request_human_permission", "TrustHub listings are available, but a recommendation needs local experience or human judgement.", undefined, communityLookup);
      }
    }
    if (evidence.length) {
      const partial = partialMatch || evidence.some((item) => item.completeness === "partial" || item.confidence === "low" || item.confidence === "unknown" || item.verificationStatus === "potential" || item.verificationStatus === "declared");
      return result(partial ? "partially_answered" : "answered", evidence, attempts, "answer", partial ? "Some evidence is incomplete or unverified." : null, undefined, communityLookup);
    }
    if (attempts.some((item) => item.source === "community" && item.status === "skipped")) return result("community_needed", [], attempts, "ask_community_permission", "No reliable TrustHub answer was found; community outreach needs your permission.", undefined, communityLookup);
    if (attempts.some((item) => item.source === "human_trust_agent" && item.status === "skipped")) return result("human_needed", [], attempts, "request_human_permission", "This may need human help; no Trust Agent handoff has been started.", undefined, communityLookup);
    return result("unresolved", [], attempts, "final_unresolved", "I haven't found enough reliable information to confirm an answer.", undefined, communityLookup);
  }
}

