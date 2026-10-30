/**
 * Plays whole test conversations against the live app's "Try Wisdom" endpoint, in order,
 * and returns the transcripts. Used for end-to-end checks of the real pipeline and data.
 */
import { rest } from "./db.ts";

interface Turn { said: string; reply: string; buttons: string[]; list: string[]; state: string | null; ms: number; error?: string }

export async function simulate(conversations: { phone: string; messages: string[] }[], base = "https://trusthub-connect.vercel.app"): Promise<{ phone: string; turns: Turn[] }[]> {
  const rows = await rest<{ value: string }[]>("benita_settings?key=eq.simulator_key&select=value");
  const key = rows[0]?.value;
  if (!key) throw new Error("no simulator_key in benita_settings");
  return await Promise.all(conversations.slice(0, 12).map(async (conversation) => {
    const turns: Turn[] = [];
    for (const said of conversation.messages.slice(0, 8)) {
      try {
        const response = await fetch(`${base}/api/admin/simulate`, {
          method: "POST", headers: { "content-type": "application/json", "x-trusthub-test-key": key },
          body: JSON.stringify({ phoneNumber: conversation.phone, text: said }), signal: AbortSignal.timeout(55_000),
        });
        const body = await response.json() as Record<string, unknown>;
        turns.push({ said, reply: String(body.reply ?? ""), buttons: (body.buttons as string[]) ?? [], list: (body.list as string[]) ?? [], state: (body.state as string) ?? null, ms: Number(body.ms ?? 0), ...(body.error ? { error: String(body.error) } : {}) });
      } catch (error) {
        turns.push({ said, reply: "", buttons: [], list: [], state: null, ms: 0, error: String(error).slice(0, 200) });
      }
    }
    return { phone: conversation.phone, turns };
  }));
}
