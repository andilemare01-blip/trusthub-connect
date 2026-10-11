import type { WhatsAppProvider } from "./provider";

/** Local orchestration seam: authenticated identity/runtime handling is injected by the caller. */
export async function runLocalWhatsAppTurn<T>(provider: WhatsAppProvider, payload: unknown, handle: (input: { senderPhoneNumber: string; providerMessageId: string; text: string; timestamp: string }) => Promise<{ reply: string; result: T }>) {
  const incoming = await provider.parseIncomingWebhook(payload);
  if (!incoming) return null;
  const handled = await handle(incoming);
  const delivery = await provider.sendMessage({ toPhoneNumber: incoming.senderPhoneNumber, text: handled.reply });
  return { ...handled, incoming, delivery };
}
