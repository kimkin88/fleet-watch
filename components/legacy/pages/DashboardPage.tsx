"use client";

import LegacyHtmlShell from "../LegacyHtmlShell";
import { css, html, script } from "./DashboardPageData";

export default function DashboardPage() {
  return (
    <LegacyHtmlShell
      css={css}
      html={html}
      script={script}
      maplibre={true}
      chartjs={false}
    />
  );
}
