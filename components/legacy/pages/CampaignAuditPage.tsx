"use client";

import LegacyHtmlShell from "../LegacyHtmlShell";
import { css, html, script } from "./CampaignAuditPageData";

export default function CampaignAuditPage() {
  return (
    <LegacyHtmlShell
      css={css}
      html={html}
      script={script}
      maplibre={false}
      chartjs={true}
    />
  );
}
