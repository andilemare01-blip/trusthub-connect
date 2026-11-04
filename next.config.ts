import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The owner's section is one static page that signs in with Supabase directly.
  async rewrites() { return [{ source: "/business", destination: "/business.html" }]; },
  // The Wisdom library is read from disk at runtime, so the serverless trace must ship it.
  outputFileTracingIncludes: {
    "/api/whatsapp/webhook": ["./docs/TRUSTHUB_WISDOM_CONVERSATION_LIBRARY.md"],
    "/api/dev/whatsapp/send": ["./docs/TRUSTHUB_WISDOM_CONVERSATION_LIBRARY.md"],
    "/api/benita/ask": ["./docs/TRUSTHUB_WISDOM_CONVERSATION_LIBRARY.md"],
    "/api/business/benita": ["./docs/TRUSTHUB_WISDOM_CONVERSATION_LIBRARY.md"],
  },
};

export default nextConfig;
