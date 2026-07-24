"use client";

import LegacyHtmlShell from "../LegacyHtmlShell";
import { css, html, script } from "./ApiProofPageData";

export default function ApiProofPage() {
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
