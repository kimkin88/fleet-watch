import type { Metadata } from "next";

export const metadata: Metadata = {
  title: {
    default: "Fleet Watch",
    template: "%s · Fleet Watch",
  },
  description:
    "Live campaign tracking and proof-of-play audit for bus advertising — TfL + BODS + Supabase.",
  icons: {
    icon: "/assets/fleet-watch-mark.svg",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#0a0a0a" }}>{children}</body>
    </html>
  );
}
