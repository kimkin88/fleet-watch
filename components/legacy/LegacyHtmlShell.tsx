"use client";

import { useEffect, useLayoutEffect, useRef } from "react";

type Props = {
  css: string;
  html: string;
  script: string;
  maplibre?: boolean;
  chartjs?: boolean;
  /** Runs after deps load and before the page script (e.g. mount Radix list scroll). */
  onBeforeScript?: () => void | Promise<void>;
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
export default function LegacyHtmlShell({
  css,
  html,
  script,
  maplibre,
  chartjs,
  onBeforeScript,
}: Props) {
  const ran = useRef(false);
  const onBeforeScriptRef = useRef(onBeforeScript);
  onBeforeScriptRef.current = onBeforeScript;

  // Keep MapLibre CSS available before paint; page CSS is inlined with HTML below
  // so logos/layout don't flash at intrinsic SVG size on navigation.
  useLayoutEffect(() => {
    if (maplibre) {
      ensureStylesheet("https://unpkg.com/maplibre-gl@5.13.0/dist/maplibre-gl.css");
    }
  }, [maplibre]);

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
        if (cancelled) return;
        if (onBeforeScriptRef.current) {
          await onBeforeScriptRef.current();
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

  const safeCss = css.replace(/<\/style/gi, "<\\/style");
  const markup = `<style data-fleet-watch-page="true">${safeCss}</style>${html}`;

  return (
    <div
      className="fleet-watch-root"
      style={{ width: "100%", minHeight: "100%", position: "relative" }}
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
}
