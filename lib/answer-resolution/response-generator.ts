import type { AnswerGenerator, GeneratedAnswer } from "@/types/answer";
import type { EvidenceItem, ResolutionResult } from "./types";
import { formatListings, isListing } from "./whatsapp-format.ts";

function claimLine(item: EvidenceItem): string {
  const details = item.businessDetails;
  const contact = [details?.phone && `Phone: ${details.phone}`, details?.whatsapp && `WhatsApp: ${details.whatsapp}`, details?.website && `Website: ${details.website}`, details?.address && `Address: ${details.address}`, details?.services?.length && `Services: ${details.services.join(", ")}`].filter(Boolean).join("; ");
  return `${item.claim}${contact ? ` ${contact}.` : ""} (source: ${item.sourceLabel}; ${item.verificationStatus}; confidence: ${item.confidence})`;
}

/** Listings become structured cards; single facts and community declarations keep their sourced sentence. */
function evidenceText(evidence: EvidenceItem[]): string {
  const listings = evidence.filter(isListing);
  const others = evidence.filter((item) => !isListing(item));
  return [listings.length ? formatListings(listings) : "", ...others.map(claimLine)].filter(Boolean).join("\n\n");
}

function responseText(resolution: ResolutionResult): string {
  if (resolution.status === "clarification_needed") return resolution.clarificationQuestion ?? "Could you clarify what you need?";
  const body = evidenceText(resolution.evidence);
  if (resolution.status === "community_needed") return [body, "TrustHub has not provided a reliable answer yet. Would you like me to ask your community? I'd only share your question, never your number. Reply yes to go ahead, or no and I'll leave it there."].filter(Boolean).join("\n\n");
  if (resolution.status === "human_needed") return [body, "This may need a person to help. Would you like me to request a Trust Agent handoff? Their availability is not confirmed yet."].filter(Boolean).join("\n\n");
  if (resolution.status === "unresolved") return "I haven't found enough reliable information to confirm that. We could try different wording or a nearby area, and if you like I can ask people in your community.";
  return `${body}${resolution.uncertainty ? `\n\n${resolution.uncertainty}` : ""}`;
}

/** Deterministic, evidence-only response formatting. It cannot add facts or verification claims. */
export class DeterministicAnswerGenerator implements AnswerGenerator {
  async generate(resolution: ResolutionResult): Promise<GeneratedAnswer> {
    return {
      text: responseText(resolution),
      evidenceIds: resolution.evidence.map((item) => item.id),
      provenance: [...resolution.provenance],
      confidence: resolution.confidence,
      uncertainty: resolution.uncertainty,
    };
  }
}

export function createAnswerGenerator(): AnswerGenerator { return new DeterministicAnswerGenerator(); }
