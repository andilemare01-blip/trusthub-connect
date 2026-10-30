import type { MetadataRoute } from "next";

/** Lets the founder's admin page be added to a phone's home screen and open like an app. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TrustHub Connect Admin",
    short_name: "TrustHub",
    description: "TrustHub Connect: people, agents, cards and growth at a glance.",
    start_url: "/admin",
    scope: "/",
    display: "standalone",
    background_color: "#f7f3ec",
    theme_color: "#0f4f47",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
