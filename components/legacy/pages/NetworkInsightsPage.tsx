"use client";

import LegacyHtmlShell from "../LegacyHtmlShell";
import { css, html, script } from "./NetworkInsightsPageData";

export default function NetworkInsightsPage() {
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
