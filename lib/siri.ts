/** BODS SIRI-VM fetch + parse (server-only). */

const MAX_BODS_BYTES = 80 * 1024 * 1024;
const BODS_URL = "https://data.bus-data.dft.gov.uk/api/v1/datafeed/";

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
    vehicles.push({
      registration: tag(activity, "VehicleRegistrationNumber") || tag(activity, "Registration") || "",
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

const caches = new Map<string, { at: number; vehicles: BodsVehicle[] }>();

function cacheKey(vehicleRefs?: string[]) {
  return vehicleRefs?.length ? `vehicleRef:${vehicleRefs.join(",")}` : "all";
}

function buildBodsUrl(key: string, vehicleRefs?: string[]) {
  const url = new URL(BODS_URL);
  url.searchParams.set("api_key", key);
  for (const ref of vehicleRefs || []) {
    url.searchParams.append("vehicleRef", ref);
  }
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

export async function fetchBodsFeed(vehicleRefs?: string[]): Promise<BodsVehicle[]> {
  const refs = [...new Set((vehicleRefs || []).map(normalise).filter(Boolean))].sort();
  const keyId = cacheKey(refs);
  const cached = caches.get(keyId);
  if (cached && Date.now() - cached.at < 20000) return cached.vehicles;
  const { key, source } = bodsKey();
  if (!key) {
    throw new Error("BODS API key is not set — add BODS_API_KEY to the server environment and restart");
  }

  const url = buildBodsUrl(key, refs);
  const res = await fetch(url, {
    headers: {
      accept: "application/xml, text/xml;q=0.9, */*;q=0.1",
      "x-api-key": key,
    },
    signal: AbortSignal.timeout(45000),
    cache: "no-store",
  });

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
        ? ` — DfT rejected the BODS key from ${source}. Use the API key from data.bus-data.dft.gov.uk account settings and pass it as ?api_key=...`
        : "";
    const scope = refs.length ? ` for vehicleRef=${refs.join(",")}` : "";
    throw new Error(`BODS returned HTTP ${res.status}${scope}${hint}${detail}`);
  }

  const xml = await readResponseText(res);
  const vehicles = parseSiriVm(xml);
  caches.set(keyId, { at: Date.now(), vehicles });
  return vehicles;
}
