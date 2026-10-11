export function handleMetaWebhookVerification(query: URLSearchParams, verifyToken: string | undefined): Response {
  if (!verifyToken) return new Response("Webhook verification is not configured.", { status: 503 });

  const challenge = query.get("hub.challenge");
  if (
    query.get("hub.mode") === "subscribe" &&
    query.get("hub.verify_token") === verifyToken &&
    challenge
  ) {
    return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
  }

  return new Response("Forbidden", { status: 403 });
}