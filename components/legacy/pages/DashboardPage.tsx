"use client";

import { useEffect } from "react";
import LegacyHtmlShell from "../LegacyHtmlShell";
import { mountVehicleListScroll, unmountVehicleListScroll } from "../mountVehicleListScroll";
import { css, html, script } from "./DashboardPageData";

export default function DashboardPage() {
  useEffect(() => () => unmountVehicleListScroll(), []);

  return (
    <LegacyHtmlShell
      css={css}
      html={html}
      script={script}
      maplibre={true}
      chartjs={false}
      onBeforeScript={mountVehicleListScroll}
    />
  );
}
