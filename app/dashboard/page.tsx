import type { Metadata } from "next";
import DashboardPage from "@/components/legacy/pages/DashboardPage";

export const metadata: Metadata = {
  title: "Fleet Watch \u00b7 Live dashboard",
  description: "Live campaign tracking for bus advertising.",
};

export default function Page() {
  return <DashboardPage />;
}
