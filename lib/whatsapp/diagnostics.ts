export type WhatsAppDiagnosticStage =
  | "webhook_request_received"
  | "signature_verification"
  | "payload_parsed"
  | "sender_message_normalized"
  | "whatsapp_identity_resolved"
  | "profile_resolved"
  | "conversation_resolved_or_created"
  | "persistent_turn_entered"
  | "conversation_messages_persistence"
  | "conversation_coordinator_completed"
  | "meta_outbound_send"
  | "meta_outbound_response"
  | "outbound_delivery_persistence"
  | "webhook_processing_failed";

interface DiagnosticFields {
  outcome: "passed" | "failed" | "attempted" | "skipped";
  [key: string]: unknown;
}

function sanitizeText(value: string): string {
  return value
    .replace(/authorization\s*[:=]\s*[^\s,;]+/gi, "authorization=[redacted]")
    .replace(/bearer\s+[^\s,;]+/gi, "Bearer [redacted]")
    .replace(/(?:access[_-]?token|app[_-]?secret|verify[_-]?token)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/\+?\d{7,15}/g, "[redacted-number]")
    .slice(0, 300);
}

export function diagnosticError(error: unknown): {
  errorName: string;
  errorMessage: string;
  errorCode?: string;
  errorDetails?: string;
  causeName?: string;
  causeMessage?: string;
} {
  const value = error instanceof Error ? error : new Error(String(error));
  const raw = error && typeof error === "object" ? error as { code?: unknown; details?: unknown; cause?: unknown } : {};
  const cause = raw.cause instanceof Error ? raw.cause : null;
  const causeText = typeof raw.cause === "string" ? raw.cause : typeof raw.details === "string"
    ? /Caused by:\s*([\s\S]*?)(?=\s+at\s|\s+Error:|$)/.exec(raw.details)?.[1]
    : undefined;
  return {
    errorName: value.name.slice(0, 100),
    errorMessage: sanitizeText(value.message),
    ...(typeof raw.code === "string" ? { errorCode: raw.code.slice(0, 100) } : {}),
    ...(typeof raw.details === "string" && !causeText ? { errorDetails: sanitizeText(raw.details) } : {}),
    ...(cause ? { causeName: cause.name.slice(0, 100), causeMessage: sanitizeText(cause.message) } : {}),
    ...(!cause && causeText ? { causeMessage: sanitizeText(causeText) } : {}),
  };
}

export function logWhatsAppDiagnostic(requestId: string, stage: WhatsAppDiagnosticStage, fields: DiagnosticFields): void {
  console.info(JSON.stringify({
    event: "whatsapp.diagnostic",
    requestId,
    stage,
    ...fields,
  }));
}
