/** BODS SIRI-VM fetch + parse (server-only). */

const MAX_BODS_BYTES = 80 * 1024 * 1024;
const BODS_URL = "https://data.bus-data.dft.gov.uk/api/v1/datafeed/";
/** DfT rejects bare datafeed calls; a bounding box is required. Covers England + Wales (+ southern Scotland fringe). */
const DEFAULT_BBOX = "-6.5,49.8,2.0,56.0";
const CACHE_TTL_MS = 20_000;
/** Serve last good feed this long after a failed refresh. */
const STALE_MAX_MS = 10 * 60_000;

export type BodsVehicle = {
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
  source: "bods";
  status: "moving" | "stopped" | "stale";
  locationQuality: "gps";
};

export type MatchedBodsVehicle = BodsVehicle & {
  /** Watchlist registration this vehicle was matched to. */
  matchedRegistration: string;
};

function bodsKey() {
  const candidates = [
    ["BODS_API_KEY", process.env.BODS_API_KEY],
    ["BODS_KEY", process.env.BODS_KEY],
    ["BODS_APIKEY", process.env.BODS_APIKEY],
  ] as const;
  for (const [name, value] of candidates) {
    const key = (value || "").trim();
    if (key) return { key, source: name };
  }
  return { key: "", source: "missing" as const };
}

function boundingBox() {
  const fromEnv = (process.env.BODS_BOUNDING_BOX || "").trim();
  return fromEnv || DEFAULT_BBOX;
}

/**
 * Known campaign wraps where BODS publishes a fleet number instead of the plate.
 * Cardiff (CN65AAY) is Wales — not on BODS. Glasgow has no plate yet.
 */
const BUILTIN_BODS_ALIASES: Record<string, string[]> = {
  BK63YWT: ["4931"], // National Express West Midlands
  ML22XKX: ["35904", "FLDS35904"], // First Leeds
};

/**
 * Optional fleet-id / alternate-ref aliases.
 * Format: `WATCHLISTREG:BODSREF,WATCHLISTREG:OTHERREF`
 * Example: `BK63YWT:4931,ML22XKX:35904`
 * Merged on top of built-in campaign aliases.
 */
export function loadBodsAliases(): Map<string, string[]> {
  const map = new Map<string, string[]>();
  const add = (left: string, right: string) => {
    const a = normalise(left);
    const b = normalise(right);
    if (!a || !b) return;
    const list = map.get(a) || [];
    if (!list.includes(b)) list.push(b);
    map.set(a, list);
    const rev = map.get(b) || [];
    if (!rev.includes(a)) rev.push(a);
    map.set(b, rev);
  };
  for (const [plate, refs] of Object.entries(BUILTIN_BODS_ALIASES)) {
    for (const ref of refs) add(plate, ref);
  }
  const raw = (process.env.BODS_REG_ALIASES || "").trim();
  if (raw) {
    for (const part of raw.split(/[,;\n]+/)) {
      const [left, right] = part.split(":");
      if (left && right) add(left, right);
    }
  }
  return map;
}

function tag(xml: string, name: string) {
  const matcher = new RegExp(
    `<(?:(?:[A-Za-z0-9_-]+):)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:(?:[A-Za-z0-9_-]+):)?${name}>`,
    "i",
  );
  const m = xml.match(matcher);
  return m ? m[1].replace(/<[^>]+>/g, "").trim() : "";
}

function numberTag(xml: string, name: string, fallback = 0) {
  const value = Number(tag(xml, name));
  return Number.isFinite(value) ? value : fallback;
}

export const normalise = (v: unknown) =>
  String(v || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 12);

/** Modern (AB12CDE) + prefix (A123BCD) UK plates. */
const UK_PLATE = /(?:[A-Z]{2}\d{2}[A-Z]{3}|[A-Z]\d{3}[A-Z]{3})/g;

export function platesIn(value: unknown): string[] {
  const n = normalise(value);
  if (!n) return [];
  const found = n.match(UK_PLATE) || [];
  if (found.length) return [...new Set(found)];
  // Keep short fleet ids / odd refs so exact matches still work.
  return n.length >= 3 ? [n] : [];
}

/** Operator fleet numbers often published as VehicleRef `4931` or `FLDS-35904`. */
export function fleetIdsIn(value: unknown): string[] {
  const n = normalise(value);
  if (!n) return [];
  const ids = new Set<string>();
  if (/^\d{3,6}$/.test(n)) ids.add(n);
  const trailing = n.match(/(\d{3,6})$/);
  if (trailing) ids.add(trailing[1]);
  return [...ids];
}

/** All identity keys we can match a watchlist registration against. */
export function bodsMatchKeys(v: { registration?: string; vehicleRef?: string }): string[] {
  const keys = new Set<string>();
  for (const raw of [v.registration, v.vehicleRef]) {
    const n = normalise(raw);
    if (n) keys.add(n);
    for (const plate of platesIn(raw)) keys.add(plate);
    for (const fleet of fleetIdsIn(raw)) keys.add(fleet);
  }
  return [...keys];
}

/** Match feed vehicles onto requested registrations (exact, plate-in-ref, aliases). */
export function matchBodsToRegistrations(
  all: BodsVehicle[],
  requested: string[],
  aliases: Map<string, string[]> = loadBodsAliases(),
): { vehicles: MatchedBodsVehicle[]; missing: string[] } {
  const index = new Map<string, BodsVehicle>();
  for (const v of all) {
    for (const key of bodsMatchKeys(v)) {
      if (!index.has(key)) index.set(key, v);
    }
  }

  const vehicles: MatchedBodsVehicle[] = [];
  const missing: string[] = [];
  const seenVehicle = new Set<string>();

  for (const raw of requested) {
    const reg = normalise(raw);
    if (!reg) continue;
    const tryKeys = [reg, ...(aliases.get(reg) || [])];
    let found: BodsVehicle | undefined;
    for (const key of tryKeys) {
      found = index.get(key);
      if (found) break;
    }
    if (!found) {
      missing.push(reg);
      continue;
    }
    const dedupe = `${found.vehicleRef}|${found.latitude}|${found.longitude}`;
    if (seenVehicle.has(dedupe)) {
      // Still count as matched for this watchlist reg.
      vehicles.push({
        ...found,
        registration: found.registration || reg,
        matchedRegistration: reg,
      });
      continue;
    }
    seenVehicle.add(dedupe);
    vehicles.push({
      ...found,
      registration: found.registration || reg,
      matchedRegistration: reg,
    });
  }

  return { vehicles, missing };
}

export function parseSiriVm(xml: string): BodsVehicle[] {
  const receivedAt = new Date().toISOString();
  const activities =
    xml.match(/<(?:[A-Za-z0-9_-]+:)?VehicleActivity\b[\s\S]*?<\/(?:[A-Za-z0-9_-]+:)?VehicleActivity>/gi) ||
    [];
  const vehicles: BodsVehicle[] = [];
  for (const activity of activities) {
    const longitude = numberTag(activity, "Longitude", NaN);
    const latitude = numberTag(activity, "Latitude", NaN);
    const vehicleRef = tag(activity, "VehicleRef");
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !vehicleRef) continue;
    const speed = numberTag(activity, "Velocity", 0);
    const recordedAt = tag(activity, "RecordedAtTime") || receivedAt;
    const taggedReg =
      tag(activity, "VehicleRegistrationNumber") ||
      tag(activity, "VehicleRegistrationMark") ||
      tag(activity, "RegistrationNumber") ||
      tag(activity, "Registration") ||
      "";
    const registration = normalise(taggedReg) || platesIn(vehicleRef)[0] || "";
    vehicles.push({
      registration,
      vehicleRef,
      operator: tag(activity, "OperatorRef"),
      route: tag(activity, "PublishedLineName") || tag(activity, "LineRef"),
      destination: tag(activity, "DestinationName") || tag(activity, "DestinationRef"),
      direction: tag(activity, "DirectionRef"),
      latitude,
      longitude,
      bearing: numberTag(activity, "Bearing", 0),
      speed,
      recordedAt,
      receivedAt,
      source: "bods",
      status: Date.now() - new Date(recordedAt).getTime() > 180000 ? "stale" : speed > 1 ? "moving" : "stopped",
      locationQuality: "gps",
    });
  }
  return vehicles;
}

let cache: { at: number; bbox: string; vehicles: BodsVehicle[] | null; stale: boolean } = {
  at: 0,
  bbox: "",
  vehicles: null,
  stale: false,
};

let inflight: Promise<BodsVehicle[]> | null = null;

function buildBodsUrl(key: string, bbox: string) {
  const url = new URL(BODS_URL);
  url.searchParams.set("api_key", key);
  url.searchParams.set("boundingBox", bbox);
  return url;
}

async function readResponseText(res: Response) {
  const reader = res.body?.getReader();
  if (!reader) throw new Error("BODS response had no body");
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    size += value.length;
    if (size > MAX_BODS_BYTES) throw new Error("BODS response exceeded 80MB size cap");
    parts.push(value);
  }
  return Buffer.concat(parts.map((p) => Buffer.from(p))).toString("utf8");
}

export function bodsFeedMeta() {
  return {
    cachedAt: cache.at || null,
    stale: cache.stale,
    count: cache.vehicles?.length ?? 0,
    bbox: cache.bbox || boundingBox(),
  };
}

async function fetchBodsFeedUncached(): Promise<BodsVehicle[]> {
  const bbox = boundingBox();
  const { key, source } = bodsKey();
  if (!key) {
    throw new Error("BODS API key is not set — add BODS_API_KEY to the server environment and restart");
  }

  const url = buildBodsUrl(key, bbox);
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        accept: "application/xml, text/xml;q=0.9, */*;q=0.1",
        "x-api-key": key,
      },
      signal: AbortSignal.timeout(45000),
      cache: "no-store",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`BODS upstream request failed: ${msg}`);
  }

  if (!res.ok) {
    let detail = "";
    try {
      const text = (await res.text()).replace(/\s+/g, " ").trim().slice(0, 180);
      if (text) detail = ` · ${text}`;
    } catch {
      /* ignore */
    }
    const hint =
      res.status === 401 || res.status === 403
        ? ` — DfT rejected the BODS request from ${source}. Confirm BODS_API_KEY and that boundingBox is set (BODS now requires query params).`
        : "";
    throw new Error(`BODS returned HTTP ${res.status}${hint}${detail}`);
  }

  const xml = await readResponseText(res);
  const vehicles = parseSiriVm(xml);
  cache = { at: Date.now(), bbox, vehicles, stale: false };
  return vehicles;
}

export async function fetchBodsFeed(): Promise<BodsVehicle[]> {
  const bbox = boundingBox();
  if (Date.now() - cache.at < CACHE_TTL_MS && cache.vehicles && cache.bbox === bbox && !cache.stale) {
    return cache.vehicles;
  }
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      return await fetchBodsFeedUncached();
    } catch (err) {
      if (cache.vehicles?.length && cache.bbox === bbox && Date.now() - cache.at < STALE_MAX_MS) {
        cache = { ...cache, stale: true };
        return cache.vehicles;
      }
      throw err;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}
