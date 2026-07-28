/** bustimes.org vehicle metadata + live positions (Wales/Scotland coverage BODS lacks). */

import { normalise, platesIn } from "./siri";

const UA = "FleetWatch/1.0 (+https://localhost; regional AVL fallback)";
const META_TTL_MS = 24 * 60 * 60 * 1000;
const POS_TTL_MS = 15_000;

export type BustimesVehicle = {
  registration: string;
  vehicleRef: string;
  operator: string;
  route: string;
  destination: string;
  direction: string;
  latitude: number;
  longitude: number;
  bearing: number;
  speed: number;
  recordedAt: string;
  receivedAt: string;
  source: "bustimes";
  status: "moving" | "stopped" | "stale";
  locationQuality: "gps";
  matchedRegistration: string;
};

type Meta = { id: number; slug: string; reg: string; fleet: string; operator: string };

const metaCache = new Map<string, { at: number; meta: Meta | null }>();
const posCache = new Map<string, { at: number; vehicles: BustimesVehicle[] }>();
const metaInflight = new Map<string, Promise<Meta | null>>();

async function fetchJson(url: string) {
  const res = await fetch(url, {
    headers: { accept: "application/json", "user-agent": UA },
    signal: AbortSignal.timeout(20000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`bustimes HTTP ${res.status}`);
  return res.json();
}

export async function resolveBustimesVehicle(registration: string): Promise<Meta | null> {
  const reg = normalise(registration);
  if (!reg) return null;
  const cached = metaCache.get(reg);
  if (cached && Date.now() - cached.at < META_TTL_MS) return cached.meta;
  if (metaInflight.has(reg)) return metaInflight.get(reg)!;

  const p = (async () => {
    try {
      const data = await fetchJson(
        `https://bustimes.org/api/vehicles/?reg=${encodeURIComponent(reg)}`,
      );
      const row = Array.isArray(data?.results) ? data.results[0] : null;
      if (!row?.id) {
        metaCache.set(reg, { at: Date.now(), meta: null });
        return null;
      }
      const meta: Meta = {
        id: Number(row.id),
        slug: String(row.slug || ""),
        reg: normalise(row.reg) || reg,
        fleet: String(row.fleet_code || row.fleet_number || ""),
        operator: String(row.operator?.id || row.operator?.name || ""),
      };
      metaCache.set(reg, { at: Date.now(), meta });
      return meta;
    } catch {
      metaCache.set(reg, { at: Date.now(), meta: null });
      return null;
    } finally {
      metaInflight.delete(reg);
    }
  })();

  metaInflight.set(reg, p);
  return p;
}

function statusFrom(recordedAt: string): "moving" | "stopped" | "stale" {
  const age = Date.now() - new Date(recordedAt).getTime();
  if (!Number.isFinite(age) || age > 180_000) return "stale";
  return "moving";
}

export async function fetchBustimesPositions(
  registrations: string[],
): Promise<{ vehicles: BustimesVehicle[]; missing: string[] }> {
  const regs = [...new Set(registrations.map(normalise).filter(Boolean))];
  if (!regs.length) return { vehicles: [], missing: [] };

  const cacheKey = regs.slice().sort().join(",");
  const cached = posCache.get(cacheKey);
  if (cached && Date.now() - cached.at < POS_TTL_MS) {
    const have = new Set(cached.vehicles.map((v) => v.matchedRegistration));
    return { vehicles: cached.vehicles, missing: regs.filter((r) => !have.has(r)) };
  }

  const metas = await Promise.all(regs.map(async (reg) => ({ reg, meta: await resolveBustimesVehicle(reg) })));
  const resolved = metas.filter((m) => m.meta);
  const unresolved = metas.filter((m) => !m.meta).map((m) => m.reg);
  if (!resolved.length) {
    posCache.set(cacheKey, { at: Date.now(), vehicles: [] });
    return { vehicles: [], missing: regs };
  }

  const vehicles: BustimesVehicle[] = [];
  const found = new Set<string>();
  const receivedAt = new Date().toISOString();

  await Promise.all(
    resolved.map(async ({ reg, meta }) => {
      if (!meta) return;
      try {
        const rows = await fetchJson(`https://bustimes.org/vehicles.json?id=${meta.id}`);
        const row = Array.isArray(rows) ? rows[0] : null;
        const coords = row?.coordinates;
        if (!row || !Array.isArray(coords) || coords.length < 2) return;
        const longitude = Number(coords[0]);
        const latitude = Number(coords[1]);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
        const recordedAt = String(row.datetime || receivedAt);
        const service = row.service || {};
        vehicles.push({
          registration: meta.reg || reg,
          vehicleRef: meta.slug || meta.fleet || String(meta.id),
          operator: meta.operator,
          route: String(service.line_name || row.block || "—"),
          destination: String(row.destination || "Unknown destination"),
          direction: "all",
          latitude,
          longitude,
          bearing: Number(row.heading) || 0,
          speed: 0,
          recordedAt,
          receivedAt,
          source: "bustimes",
          status: statusFrom(recordedAt),
          locationQuality: "gps",
          matchedRegistration: reg,
        });
        found.add(reg);
      } catch {
        /* per-vehicle miss is fine */
      }
    }),
  );

  posCache.set(cacheKey, { at: Date.now(), vehicles });
  return {
    vehicles,
    missing: [...unresolved, ...resolved.map((r) => r.reg).filter((r) => !found.has(r))],
  };
}

/** Debug helper: does this registration resolve on bustimes? */
export async function bustimesLookup(registration: string) {
  const meta = await resolveBustimesVehicle(registration);
  if (!meta) return { ok: false, registration: normalise(registration), meta: null, vehicle: null };
  const { vehicles } = await fetchBustimesPositions([registration]);
  return { ok: true, registration: normalise(registration), meta, vehicle: vehicles[0] || null };
}

export function bustimesMatchKeys(v: { registration?: string; vehicleRef?: string; name?: string }) {
  const keys = new Set<string>();
  for (const raw of [v.registration, v.vehicleRef, v.name]) {
    const n = normalise(raw);
    if (n) keys.add(n);
    for (const plate of platesIn(raw)) keys.add(plate);
  }
  return [...keys];
}
