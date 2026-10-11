import Simulator from "./simulator";

export const dynamic = "force-dynamic";

/** The simulator never renders in a production build. */
export default function DevWhatsAppPage() {
  if (process.env.NODE_ENV === "production") {
    return (
      <main style={{ fontFamily: "system-ui, sans-serif", padding: 24 }}>
        <h1>Unavailable</h1>
        <p>This development-only WhatsApp simulator is not available in production.</p>
      </main>
    );
  }
  return <Simulator />;
}
