import type { Metadata } from "next";
import CampaignAuditPage from "@/components/legacy/pages/CampaignAuditPage";

export const metadata: Metadata = {
  title: "Fleet Watch \u00b7 Campaign audit",
  description: "Proof-of-play audit for bus advertising campaigns.",
};

export default function Page() {
  return <CampaignAuditPage />;
}
