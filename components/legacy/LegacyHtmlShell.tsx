"use client";

import { useEffect, useLayoutEffect, useRef } from "react";

type Props = {
  css: string;
  html: string;
  script: string;
  maplibre?: boolean;
  chartjs?: boolean;
};

async function loadScript(src: string) {
  if (document.querySelector(`script[data-fw-src="${src}"]`)) return;
  await new Promise<void>((resolve, reject) => {
    const el = document.createElement("script");
    el.src = src;
    el.async = false;
    el.dataset.fwSrc = src;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(el);
  });
}

function ensureStylesheet(href: string) {
  if (document.querySelector(`link[data-fw-href="${href}"]`)) return;
  const el = document.createElement("link");
  el.rel = "stylesheet";
  el.href = href;
  el.dataset.fwHref = href;
  document.head.appendChild(el);
}

/**
 * Renders legacy page CSS/HTML/JS. Must be a real block box (not display:contents)
 * so Radix Scroll Area can measure content height.
 */
export default function LegacyHtmlShell({ css, html, script, maplibre, chartjs }: Props) {
  const ran = useRef(false);

  useLayoutEffect(() => {
    const style = document.createElement("style");
    style.setAttribute("data-fleet-watch-page", "true");
    style.textContent = css;
    document.head.appendChild(style);

    if (maplibre) {
      ensureStylesheet("https://unpkg.com/maplibre-gl@5.13.0/dist/maplibre-gl.css");
    }

    return () => {
      style.remove();
    };
  }, [css, maplibre]);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    let cancelled = false;

    (async () => {
      try {
        if (maplibre) {
          ensureStylesheet("https://unpkg.com/maplibre-gl@5.13.0/dist/maplibre-gl.css");
          await loadScript("https://unpkg.com/maplibre-gl@5.13.0/dist/maplibre-gl.js");
        }
        if (chartjs) {
          await loadScript("https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js");
        }
        if (cancelled || !script.trim()) return;
        const runner = new Function(script);
        runner();
      } catch (err) {
        console.error("Fleet Watch page init failed", err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [script, maplibre, chartjs]);

  return (
    <div
      className="fleet-watch-root"
      style={{ width: "100%", minHeight: "100%", position: "relative" }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
