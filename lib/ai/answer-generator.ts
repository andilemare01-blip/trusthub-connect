import type { AnswerGenerator, GeneratedAnswer } from "@/types/answer";
import type { ResolutionResult } from "../answer-resolution/types.ts";
import { AiGateway } from "./gateway.ts";
import { describeVerification } from "../answer-resolution/whatsapp-format.ts";

const MAX_EVIDENCE = 5;
const MAX_OUTPUT_CHARS = 1200;
const SYSTEM_PROMPT = "Rewrite the search results below as one short, friendly WhatsApp message. "
  + "Use only the facts given. Keep every business name, contact detail, source label and verification status exactly as written. "
  + "Do not add facts, ratings, recommendations or claims of verification. Maximum 120 words.";

const numbersIn = (value: string) => new Set(value.match(/\d[\d\s-]{4,}\d/g)?.map((item) => item.replace(/\D/g, "")) ?? []);
const linksIn = (value: string) => new Set(value.toLowerCase().match(/https?:\/\/\S+|www\.\S+/g) ?? []);

/** AI only rephrases the deterministic, sourced answer; anything that drops or adds a fact is discarded. */
export class AiAnswerGenerator implements AnswerGenerator {
  private readonly base: AnswerGenerator;
  private readonly gateway: AiGateway;
  private readonly key: string;
  constructor(base: AnswerGenerator, gateway: AiGateway, key: string) { this.base = base; this.gateway = gateway; this.key = key; }

  async generate(resolution: ResolutionResult): Promise<GeneratedAnswer> {
    const grounded = await this.base.generate(resolution);
    const useful = resolution.status === "answered" || resolution.status === "partially_answered";
    if (!this.gateway.enabled || !useful || !resolution.evidence.length || resolution.evidence.length > MAX_EVIDENCE) return grounded;
    const result = await this.gateway.complete({ key: `${this.key}:present`, purpose: "present", system: SYSTEM_PROMPT, user: grounded.text });
    if (!result.ok) return grounded;
    const text = result.text.trim();
    const lower = text.toLowerCase();
    const keepsAttribution = resolution.evidence.every((item) => lower.includes(item.sourceLabel.toLowerCase()) && (lower.includes(String(item.verificationStatus).toLowerCase()) || lower.includes(describeVerification(item))));
    const knownNumbers = numbersIn(grounded.text);
    const knownLinks = linksIn(grounded.text);
    const addsNothing = [...numbersIn(text)].every((value) => knownNumbers.has(value)) && [...linksIn(text)].every((value) => knownLinks.has(value));
    if (!text || text.length > MAX_OUTPUT_CHARS || !keepsAttribution || !addsNothing) return grounded;
    const withUncertainty = resolution.uncertainty && !lower.includes(resolution.uncertainty.toLowerCase()) ? `${text}\n${resolution.uncertainty}` : text;
    return { ...grounded, text: withUncertainty };
  }
}
