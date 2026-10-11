import type { DeduplicationResult, NormalizedBusiness, SeedRecord } from "@/types/seed";

export class NotConnectedError extends Error {
  constructor(method: string) {
    super(`SeedOrchestrator.${method} is not connected yet.`);
    this.name = "NotConnectedError";
  }
}

/**
 * NEW, non-live seed/discovery pipeline skeleton — a SEPARATE track from
 * TrustHub's existing `lib/business-seeding/*` pipeline, which is NOT
 * deleted, rewritten, or touched by this file. Intended to eventually
 * replace/retire the old pipeline only after validation (e.g. against
 * Chinhoyi). Pipeline shape: SOURCE → EXTRACT → NORMALIZE → LOCATION
 * RESOLVE → CATEGORY NORMALIZE → DEDUPLICATE → PROVENANCE → QUALITY CHECK
 * → TRUSTHUB.
 */
export interface SeedOrchestrator {
  extract(source: string): Promise<SeedRecord[]>;
  normalize(record: SeedRecord): Promise<NormalizedBusiness>;
  deduplicate(candidate: NormalizedBusiness): Promise<DeduplicationResult>;
}

class NotConnectedSeedOrchestrator implements SeedOrchestrator {
  async extract(): Promise<SeedRecord[]> {
    throw new NotConnectedError("extract");
  }

  async normalize(): Promise<NormalizedBusiness> {
    throw new NotConnectedError("normalize");
  }

  async deduplicate(): Promise<DeduplicationResult> {
    throw new NotConnectedError("deduplicate");
  }
}

/** TODO: implement per-source adapters only after an approved source is chosen; no source is connected in this task. */
export function createSeedOrchestrator(): SeedOrchestrator {
  return new NotConnectedSeedOrchestrator();
}
