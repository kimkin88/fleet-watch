/** BODS SIRI-VM fetch + parse (server-only). */

const MAX_BODS_BYTES = 80 * 1024 * 1024;

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
  const fromEnv = (process.env.BODS_API_KEY || "").trim();
  return { key: fromEnv, source: fromEnv ? ("env" as const) : ("missing" as const) };
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

let cache: { at: number; vehicles: BodsVehicle[] | null } = { at: 0, vehicles: null };

export async function fetchBodsFeed(): Promise<BodsVehicle[]> {
  if (Date.now() - cache.at < 20000 && cache.vehicles) return cache.vehicles;
  const { key } = bodsKey();
  if (!key) throw new Error("BODS_API_KEY is not set — add it to .env.local and restart");

  const url = `https://data.bus-data.dft.gov.uk/api/v1/datafeed/?api_key=${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    headers: { accept: "application/xml,text/xml" },
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
        ? " — DfT rejected this BODS_API_KEY. Copy a fresh key from data.bus-data.dft.gov.uk → Account settings into .env.local (not the old shared key) and restart"
        : "";
    throw new Error(`BODS returned HTTP ${res.status}${hint}${detail}`);
  }

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
  const xml = Buffer.concat(parts.map((p) => Buffer.from(p))).toString("utf8");
  const vehicles = parseSiriVm(xml);
  cache = { at: Date.now(), vehicles };
  return vehicles;
}
