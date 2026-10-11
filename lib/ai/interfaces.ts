import type { ConversationMessage } from "@/types/conversation";
import type { RequestIntent } from "@/types/service-request";

export class AIInterfaceNotConnectedError extends Error {
  constructor(method: string) {
    super(`${method} is not connected yet. No AI provider credentials have been configured. AI interprets — it must never manufacture trust or verification status.`);
    this.name = "AIInterfaceNotConnectedError";
  }
}

/** Classifies what a user is trying to accomplish. Deterministic operations (lookup, counting, routing) must NOT depend on this. */
export interface IntentClassifier {
  classify(text: string): Promise<RequestIntent | null>;
}

/** Extracts structured fields (e.g. category, location mentions) from free text. */
export interface EntityExtractor {
  extract(text: string): Promise<Record<string, string>>;
}

/** Extracts a structured contribution candidate (capability/recommendation) from free text — never auto-verified. */
export interface ContributionExtractor {
  extractContribution(text: string): Promise<Record<string, string> | null>;
}

/** Interprets a conversation transcript (e.g. from voice) into normalized turns. */
export interface ConversationInterpreter {
  interpret(messages: ConversationMessage[]): Promise<string>;
}

/** Composes a natural-language reply from structured data — never decides trust/verification. */
export interface ResponseComposer {
  compose(structuredAnswer: Record<string, unknown>): Promise<string>;
}

class NotConnectedIntentClassifier implements IntentClassifier {
  async classify(): Promise<RequestIntent | null> {
    throw new AIInterfaceNotConnectedError("IntentClassifier.classify");
  }
}

class NotConnectedEntityExtractor implements EntityExtractor {
  async extract(): Promise<Record<string, string>> {
    throw new AIInterfaceNotConnectedError("EntityExtractor.extract");
  }
}

class NotConnectedContributionExtractor implements ContributionExtractor {
  async extractContribution(): Promise<Record<string, string> | null> {
    throw new AIInterfaceNotConnectedError("ContributionExtractor.extractContribution");
  }
}

class NotConnectedConversationInterpreter implements ConversationInterpreter {
  async interpret(): Promise<string> {
    throw new AIInterfaceNotConnectedError("ConversationInterpreter.interpret");
  }
}

class NotConnectedResponseComposer implements ResponseComposer {
  async compose(): Promise<string> {
    throw new AIInterfaceNotConnectedError("ResponseComposer.compose");
  }
}

export function createIntentClassifier(): IntentClassifier {
  return new NotConnectedIntentClassifier();
}

export function createEntityExtractor(): EntityExtractor {
  return new NotConnectedEntityExtractor();
}

export function createContributionExtractor(): ContributionExtractor {
  return new NotConnectedContributionExtractor();
}

export function createConversationInterpreter(): ConversationInterpreter {
  return new NotConnectedConversationInterpreter();
}

export function createResponseComposer(): ResponseComposer {
  return new NotConnectedResponseComposer();
}
