import type { Metadata } from "next";
import NetworkInsightsPage from "@/components/legacy/pages/NetworkInsightsPage";

export const metadata: Metadata = {
  title: "Fleet Watch \u00b7 Network insights",
  description: "Live TfL network dashboards.",
};

export default function Page() {
  return <NetworkInsightsPage />;
}
