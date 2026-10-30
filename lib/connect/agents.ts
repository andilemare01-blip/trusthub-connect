/** TrustHub agents: people who promote Connect with their own link and see who joined through them. */

/** The TrustHub Connect WhatsApp number people message, digits only (e.g. 263719465412). */
export function connectWhatsappNumber(): string | null {
  const digits = (process.env.TRUSTHUB_WHATSAPP_NUMBER ?? "").replace(/\D/g, "");
  return digits.length >= 8 ? digits : null;
}

/** A short code from the agent's name plus digits, e.g. "TINO42". */
export function makeAgentCode(name: string, random: () => number = Math.random): string {
  const letters = name.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 6) || "AGENT";
  return `${letters}${String(Math.floor(10 + random() * 89))}`;
}

/** The WhatsApp message an agent's link opens with; Wisdom reads the code and removes it. */
export function referralMessage(code: string): string {
  return `Hi (ref ${code})`;
}

/** Ready-to-post text for an agent, with their link. */
export function shareText(link: string): string {
  return [
    "Need a plumber, a house to rent, a job or the best price in town? Just ask TrustHub Connect on WhatsApp 👇",
    "",
    "✅ Find trusted businesses near you",
    "🏠 Houses, cars and jobs in one chat",
    "💵 Today's fuel prices and the ZiG rate",
    "🚨 Check a number before you pay a deposit",
    "",
    `Tap to chat: ${link}`,
  ].join("\n");
}

/** +263 77X XXX 567: agents see who joined without seeing full numbers. */
export function maskNumber(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 9 ? `+${digits.slice(0, 3)} ${digits.slice(3, 5)}X XXX ${digits.slice(-3)}` : "Hidden";
}
