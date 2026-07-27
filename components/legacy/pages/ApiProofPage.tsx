"use client";

import { useEffect } from "react";
import LegacyHtmlShell from "../LegacyHtmlShell";
import { mountApiProofScrolls, unmountApiProofScrolls } from "../mountVehicleListScroll";
import { css, html, script } from "./ApiProofPageData";

export default function ApiProofPage() {
  useEffect(() => () => unmountApiProofScrolls(), []);

  return (
    <LegacyHtmlShell
      css={css}
      html={html}
      script={script}
      maplibre={true}
      chartjs={false}
      onBeforeScript={mountApiProofScrolls}
    />
  );
}
