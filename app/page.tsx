import type { Metadata } from "next";
import LandingPage from "@/components/legacy/pages/LandingPage";

export const metadata: Metadata = {
  title: "Fleet Watch \u00b7 Proof of play for moving advertising",
  description: "Independent proof-of-play for bus advertising.",
};

export default function Page() {
  return <LandingPage />;
}
