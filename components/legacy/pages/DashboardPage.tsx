"use client";

import { useEffect } from "react";
import LegacyHtmlShell from "../LegacyHtmlShell";
import { mountVehicleListScroll, unmountVehicleListScroll } from "../mountVehicleListScroll";
import { css, html, script } from "./DashboardPageData";

export type DashboardVariant = "main" | "alt";

const STORE_KEYS: Record<DashboardVariant, string> = {
  main: "fw-preview",
  alt: "fw-preview-2",
};

function dashboardHtml(variant: DashboardVariant) {
  let page = html;
  if (variant === "alt") {
    page = page.replace(
      `<span class="active" aria-current="page">Dashboard</span><a href="/dashboard-2">Dashboard 2</a>`,
      `<a href="/dashboard">Dashboard</a><span class="active" aria-current="page">Dashboard 2</span>`,
    );
  }

  const switchLink =
    variant === "alt"
      ? `<a class="text-button" href="/dashboard" style="display:inline-block;margin-left:18px">Main dashboard <span>↗</span></a>`
      : `<a class="text-button" href="/dashboard-2" style="display:inline-block;margin-left:18px">Second workspace <span>↗</span></a>`;

  page = page.replace(
    `</button></div>\n  </section>\n  <section class="notice">`,
    `</button>${switchLink}</div>\n  </section>\n  <section class="notice">`,
  );

  if (variant === "alt") {
    page = page
      .replace(
        "Live transport feeds<small>· Live bus positions across London and the rest of England, whenever available.</small>",
        "Second workspace<small>· Saved in Supabase. Anyone who opens this link sees the same campaign.</small>",
      )
      .replace("LIVE CAMPAIGN FLEET", "SECOND WORKSPACE")
      .replace(
        "Upload a campaign CSV of registrations and adverts. Fleet Watch matches them against transport feeds, then lets you switch each brand on or off across the map.",
        "Upload a different campaign CSV on this link. It is stored in Supabase, separate from the main dashboard, and shared with anyone who has this link.",
      )
      .replace(
        "Import a campaign CSV, or load the sample campaign to see the dashboard working.",
        "Loading this workspace from Supabase…",
      );
  }

  return page;
}

export default function DashboardPage({ variant = "main" }: { variant?: DashboardVariant }) {
  useEffect(() => () => unmountVehicleListScroll(), []);
  const storeKey = STORE_KEYS[variant];

  return (
    <LegacyHtmlShell
      key={variant}
      css={css}
      html={dashboardHtml(variant)}
      script={script}
      maplibre={true}
      chartjs={false}
      onBeforeScript={() => {
        const pageWindow = window as Window & { __FW_STORE?: string; __FW_REMOTE?: string };
        pageWindow.__FW_STORE = storeKey;
        // Dashboard 1 stays in this browser. Only Dashboard 2 is the shared Supabase list.
        pageWindow.__FW_REMOTE = variant === "alt" ? "/api/watchlist?workspace=dashboard-2" : "";
        mountVehicleListScroll();
      }}
    />
  );
}
