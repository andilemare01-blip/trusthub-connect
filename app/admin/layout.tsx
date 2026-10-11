import type { Metadata } from "next";

// The page is an empty shell until /api/admin/dashboard accepts the caller's token; the API is the access control.
export const metadata: Metadata = {
  title: "TrustHub Admin",
  description: "TrustHub Connect operations dashboard.",
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
