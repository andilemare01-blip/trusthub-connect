import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Wisdom library is read from disk at runtime, so the serverless trace must ship it.
  outputFileTracingIncludes: {
    "/api/whatsapp/webhook": ["./docs/TRUSTHUB_WISDOM_CONVERSATION_LIBRARY.md"],
    "/api/dev/whatsapp/send": ["./docs/TRUSTHUB_WISDOM_CONVERSATION_LIBRARY.md"],
  },
};

export default nextConfig;
