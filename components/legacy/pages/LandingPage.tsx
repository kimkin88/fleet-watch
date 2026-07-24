"use client";

import LegacyHtmlShell from "../LegacyHtmlShell";
import { css, html, script } from "./LandingPageData";

export default function LandingPage() {
  return (
    <LegacyHtmlShell
      css={css}
      html={html}
      script={script}
      maplibre={false}
      chartjs={false}
    />
  );
}
