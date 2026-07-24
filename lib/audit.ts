/**
 * Audit facade: Supabase when configured, otherwise local file store
 * (audit-data.json) on non-Vercel / when AUDIT_LOCAL=1.
 *
 * Under-the-hood sampling: any /api/audit hit starts the local minute
 * interval (long-lived Node), and kicks a sample when the last one is stale
 * (works on Vercel too while /campaign-audit is open and polling).
 */
import * as local from "./audit-local";
import * as sb from "./audit-sb";

const STALE_MS = 55_000;

export function localEnabled() {
  return !process.env.VERCEL || process.env.AUDIT_LOCAL === "1";
}

export function configured() {
  return sb.configured() || localEnabled();
}

function useSupabase() {
  return sb.configured();
}

export async function summary() {
  if (useSupabase()) return sb.summary();
  if (localEnabled()) return local.summary();
  return {
    ok: false,
    error:
      "Audit store not configured. Locally it works automatically; on Vercel set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY and run supabase/schema.sql.",
    campaigns: [],
    activity: {},
    vehicles: {},
    weather: {},
    sampler: { running: false, storage: "unconfigured" },
    dayWindow: { start: 6, end: 18, timezone: "Europe/London" },
    storage: "unconfigured",
  };
}

export async function addCampaign(input: unknown) {
  if (useSupabase()) return sb.addCampaign(input as any);
  if (localEnabled()) return local.addCampaign(input);
  return { error: "Audit store not configured" };
}

export async function removeCampaign(id: string) {
  if (useSupabase()) return sb.removeCampaign(id);
  if (localEnabled()) return local.removeCampaign(id);
  return false;
}

export async function sample() {
  if (useSupabase()) return sb.sample();
  if (localEnabled()) return local.sample();
  throw new Error("Audit store not configured");
}

/** Start local interval + kick a sample if last run is stale. Non-blocking sample kick. */
export async function ensureSampling() {
  if (useSupabase()) {
    try {
      const data = await sb.summary();
      const last = data?.sampler?.lastSampleAt ? Date.parse(data.sampler.lastSampleAt) : 0;
      if (!Number.isFinite(last) || Date.now() - last > STALE_MS) {
        sample().catch(() => {});
      }
    } catch {
      sample().catch(() => {});
    }
    return;
  }
  if (localEnabled()) {
    local.start();
    if (local.lastSampleAgeMs() > STALE_MS) {
      sample().catch(() => {});
    }
  }
}

export { start as startLocal } from "./audit-local";
