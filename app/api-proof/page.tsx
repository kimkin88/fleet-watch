import type { Metadata } from "next";
import ApiProofPage from "@/components/legacy/pages/ApiProofPage";

export const metadata: Metadata = {
  title: "Fleet Watch \u00b7 API proof",
  description: "Live endpoint directory and vehicle inventory.",
};

export default function Page() {
  return <ApiProofPage />;
}
