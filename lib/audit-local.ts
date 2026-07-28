// @ts-nocheck
/**
 * File-backed campaign audit for local Next.js (`npm run dev` / `npm run start`).
 * Persists to audit-data.json. Minutes accumulate while the Node process is up;
 * opening /campaign-audit (or any /api/audit hit) starts the minute sampler under the hood.
 */
import fs from "fs";
import path from "path";
import { fetchBodsFeed, matchBodsToRegistrations, normalise } from "./siri";

const DATA_FILE = path.join(process.cwd(), "audit-data.json");
const TFL_KEY = (process.env.TFL_API_KEY || "").trim() || "37ac7c834d654d80b34696ee7366f32e";
const DVLA_KEY = (process.env.DVLA_API_KEY || "").trim();
const DAY_START = 6,
  DAY_END = 18;
const LONDON = { lat: 51.5072, lng: -0.1276 };
const WET_CODES = new Set([
  51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99,
]);

type State = {
  campaigns: any[];
  activity: Record<string, any>;
  vehicles: Record<string, any>;
  weather: Record<string, any>;
};

let state: State = { campaigns: [], activity: {}, vehicles: {}, weather: {} };
try {
  state = Object.assign(state, JSON.parse(fs.readFileSync(DATA_FILE, "utf8")));
} catch {
  /* fresh */
}
state.vehicles = state.vehicles || {};
state.weather = state.weather || {};

let dirty = false;
const lastPos = new Map<string, { lat: number; lng: number }>();
let lastWeatherAt = 0;
const sampler: any = {
  running: false,
  lastSampleAt: null,
  lastError: null,
  tracked: 0,
  seenBods: 0,
  seenTfl: 0,
  intervalMinutes: 1,
  startedAt: null,
  dvlaEnabled: !!DVLA_KEY,
  weatherSource: "open-meteo.com",
  lastWeather: null,
  host: "local",
  storage: "local",
};

function save(force?: boolean) {
  if (!dirty && !force) return;
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(state));
    dirty = false;
  } catch (err: any) {
    sampler.lastError = "save: " + err.message;
  }
}

function londonNow() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => (parts.find((p) => p.type === t) || {}).value || "00";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) % 24 };
}

function bucket(reg: string, date: string) {
  const a = state.activity;
  a[reg] = a[reg] || {};
  a[reg][date] = a[reg][date] || { dm: 0, ds: 0, nm: 0, ns: 0, km: 0 };
  if (typeof a[reg][date].km !== "number") a[reg][date].km = 0;
  return a[reg][date];
}

function activeRegs() {
  const now = Date.now();
  const set = new Set<string>();
  state.campaigns.forEach((c) => {
    const s = new Date(c.start + "T00:00:00").getTime();
    const e = new Date(c.end + "T23:59:59").getTime();
    if (now >= s && now <= e) c.registrations.forEach((r: string) => set.add(normalise(r)));
  });
  return set;
}

function metres(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const dx = (a.lng - b.lng) * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180);
  const dy = a.lat - b.lat;
  return Math.sqrt(dx * dx + dy * dy) * 111320;
}

function euroFromYear(year: number | null) {
  if (!year) return null;
  if (year >= 2014) return "VI";
  if (year >= 2009) return "V";
  if (year >= 2006) return "IV";
  if (year >= 2001) return "III";
  return "II";
}

function yearFromPlate(reg: string) {
  const m = reg.match(/^[A-Z]{2}(\d{2})[A-Z]{3}$/);
  if (!m) return null;
  const n = Number(m[1]);
  const year = n >= 50 ? 2000 + (n - 50) : 2000 + n;
  return year >= 2001 && year <= new Date().getFullYear() ? year : null;
}

async function enrichVehicle(reg: string) {
  reg = normalise(reg);
  if (!reg || state.vehicles[reg]) return;
  let info: any = null;
  if (DVLA_KEY) {
    try {
      const r = await fetch("https://driver-vehicle-licensing.api.gov.uk/vehicle-enquiry/v1/vehicles", {
        method: "POST",
        headers: { "x-api-key": DVLA_KEY, "content-type": "application/json" },
        body: JSON.stringify({ registrationNumber: reg }),
      });
      if (r.ok) {
        const d = await r.json();
        const year = Number(d.yearOfManufacture) || null;
        info = {
          euro: (d.euroStatus ? String(d.euroStatus).replace(/euro\s*/i, "").trim() : null) || euroFromYear(year) || "VI",
          euroSource: d.euroStatus ? "dvla" : year ? "dvla-year" : "assumed",
          fuel: d.fuelType || "DIESEL",
          year,
          make: d.make || "",
          checkedAt: new Date().toISOString(),
        };
      } else if (r.status === 404) {
        info = {
          euro: "VI",
          euroSource: "assumed",
          fuel: "DIESEL",
          year: null,
          make: "",
          note: "Not found in DVLA VES",
          checkedAt: new Date().toISOString(),
        };
      }
    } catch {
      /* estimate */
    }
  }
  if (!info) {
    const year = yearFromPlate(reg);
    info = {
      euro: euroFromYear(year) || "VI",
      euroSource: year ? "plate-year" : "assumed",
      fuel: "DIESEL",
      year,
      make: "",
      checkedAt: new Date().toISOString(),
    };
  }
  state.vehicles[reg] = info;
  dirty = true;
}

async function enrichAll(regs: string[]) {
  for (const reg of regs) {
    await enrichVehicle(reg);
    await new Promise((r) => setTimeout(r, DVLA_KEY ? 250 : 0));
  }
  save(false);
}

function fleetCentre() {
  const pts = [...lastPos.values()];
  if (!pts.length) return LONDON;
  return {
    lat: pts.reduce((a, p) => a + p.lat, 0) / pts.length,
    lng: pts.reduce((a, p) => a + p.lng, 0) / pts.length,
  };
}

async function sampleWeather(date: string, day: boolean) {
  if (Date.now() - lastWeatherAt < 15 * 60000) return;
  lastWeatherAt = Date.now();
  try {
    const c = fleetCentre();
    const r = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${c.lat.toFixed(3)}&longitude=${c.lng.toFixed(3)}&current=temperature_2m,precipitation,weather_code`,
    );
    if (!r.ok) throw new Error(`open-meteo ${r.status}`);
    const d = await r.json();
    const cur = d.current || {};
    const wet = WET_CODES.has(Number(cur.weather_code)) || Number(cur.precipitation) > 0;
    const w = (state.weather[date] = state.weather[date] || { n: 0, wet: 0, dayN: 0, dayWet: 0, tempSum: 0 });
    w.n++;
    w.tempSum += Number(cur.temperature_2m) || 0;
    if (wet) w.wet++;
    if (day) {
      w.dayN++;
      if (wet) w.dayWet++;
    }
    sampler.lastWeather = {
      at: new Date().toISOString(),
      temp: cur.temperature_2m,
      wet,
      code: cur.weather_code,
      lat: c.lat,
      lng: c.lng,
    };
    dirty = true;
  } catch (err: any) {
    sampler.lastError = "weather: " + (err.message || err);
  }
}

async function sample() {
  const regs = activeRegs();
  sampler.tracked = regs.size;
  sampler.lastSampleAt = new Date().toISOString();
  sampler.seenBods = 0;
  sampler.seenTfl = 0;
  const { date, hour } = londonNow();
  const day = hour >= DAY_START && hour < DAY_END;
  if (regs.size) await sampleWeather(date, day);
  if (!regs.size) {
    save(false);
    return { ok: true, tracked: 0, seenBods: 0, seenTfl: 0 };
  }
  const seen = new Set<string>();

  try {
    const feed = await fetchBodsFeed();
    const byReg = new Map();
    const { vehicles: matched } = matchBodsToRegistrations(feed, [...regs]);
    matched.forEach((v) => {
      const reg = v.matchedRegistration;
      if (byReg.has(reg)) return;
      byReg.set(reg, v);
    });
    byReg.forEach((v, reg) => {
      seen.add(reg);
      sampler.seenBods++;
      const pos = { lat: v.latitude, lng: v.longitude };
      const prev = lastPos.get(reg);
      const dist = prev ? metres(pos, prev) : 0;
      const moving = v.speed > 1 || dist > 40;
      lastPos.set(reg, pos);
      const b = bucket(reg, date);
      if (day) {
        moving ? b.dm++ : b.ds++;
      } else {
        moving ? b.nm++ : b.ns++;
      }
      if (dist > 0 && dist < 2000) b.km += dist / 1000;
    });
    sampler.lastError = null;
  } catch (err: any) {
    sampler.lastError = "BODS: " + (err.message || err);
  }

  const missing = [...regs].filter((r) => !seen.has(r));
  for (let i = 0; i < missing.length; i += 25) {
    const ids = missing.slice(i, i + 25);
    try {
      const r = await fetch(
        `https://api.tfl.gov.uk/Vehicle/${encodeURIComponent(ids.join(","))}/Arrivals?app_key=${TFL_KEY}`,
      );
      if (!r.ok) continue;
      const preds = await r.json();
      const found = new Set(
        (Array.isArray(preds) ? preds : [])
          .map((p) => normalise(String(p.vehicleId || "")))
          .filter(Boolean),
      );
      found.forEach((reg) => {
        if (!regs.has(reg) || seen.has(reg)) return;
        seen.add(reg);
        sampler.seenTfl++;
        const b = bucket(reg, date);
        if (day) b.dm++;
        else b.nm++;
      });
    } catch {
      /* skip */
    }
  }
  if (seen.size) dirty = true;
  save(false);
  return {
    ok: true,
    tracked: regs.size,
    seenBods: sampler.seenBods,
    seenTfl: sampler.seenTfl,
    lastError: sampler.lastError,
  };
}

let timer: ReturnType<typeof setInterval> | null = null;
let saver: ReturnType<typeof setInterval> | null = null;

function start(intervalMs = 60000) {
  if (timer) return;
  sampler.running = true;
  sampler.startedAt = new Date().toISOString();
  sampler.intervalMinutes = intervalMs / 60000;
  timer = setInterval(() => {
    sample().catch((err) => {
      sampler.lastError = String(err.message || err);
    });
  }, intervalMs);
  saver = setInterval(() => save(false), 5 * 60000);
  sample().catch((err) => {
    sampler.lastError = String(err.message || err);
  });
  const allRegs = [...new Set(state.campaigns.flatMap((c) => c.registrations.map(normalise)))];
  enrichAll(allRegs).catch(() => {});
}

function addCampaign(input: any) {
  const name = String(input.name || "").trim().slice(0, 80);
  const startDate = String(input.start || "").slice(0, 10);
  const end = String(input.end || "").slice(0, 10);
  const registrations = [
    ...new Set(
      (Array.isArray(input.registrations) ? input.registrations : []).map(normalise).filter(Boolean),
    ),
  ].slice(0, 300);
  if (!name || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || !registrations.length) {
    return { error: "A campaign name, valid start and end dates, and at least one registration are required" };
  }
  if (end < startDate) return { error: "The end date is before the start date" };
  const campaign = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name,
    start: startDate,
    end,
    registrations,
    createdAt: new Date().toISOString(),
  };
  state.campaigns.push(campaign);
  dirty = true;
  save(true);
  enrichAll(registrations).catch(() => {});
  start();
  return { campaign };
}

function removeCampaign(id: string) {
  const before = state.campaigns.length;
  state.campaigns = state.campaigns.filter((c) => c.id !== id);
  if (state.campaigns.length !== before) {
    dirty = true;
    save(true);
    return true;
  }
  return false;
}

function summary() {
  return {
    ok: true,
    campaigns: state.campaigns,
    activity: state.activity,
    vehicles: state.vehicles,
    weather: state.weather,
    sampler: { ...sampler, running: !!timer || sampler.running, storage: "local" },
    dayWindow: { start: DAY_START, end: DAY_END, timezone: "Europe/London" },
    storage: "local",
  };
}

function lastSampleAgeMs() {
  if (!sampler.lastSampleAt) return Infinity;
  return Date.now() - Date.parse(sampler.lastSampleAt);
}

export { start, addCampaign, removeCampaign, summary, sample, save, lastSampleAgeMs };
export const configured = () => true;
