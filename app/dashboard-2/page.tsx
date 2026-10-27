import type { Metadata } from "next";
import DashboardPage from "@/components/legacy/pages/DashboardPage";

export const metadata: Metadata = {
  title: "Fleet Watch · Second workspace",
  description: "A separate live campaign dashboard. Uploads on this link stay here.",
};

export default function Page() {
  return <DashboardPage variant="alt" />;
}
