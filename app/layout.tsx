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
      <body style={{ margin: 0, background: "#0a0a0a" }}>
        {/* Prevent logo FOUC before page CSS mounts — UI mark is always 34×34 */}
        <style
          dangerouslySetInnerHTML={{
            __html:
              "img.brand-logo,.nav-brand img,.foot-brand img{display:block;width:34px;height:34px;max-width:34px;max-height:34px;object-fit:contain;flex:0 0 auto}",
          }}
        />
        {children}
      </body>
    </html>
  );
}
