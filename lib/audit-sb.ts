// @ts-nocheck
/*
 * Supabase-backed campaign audit.
 * Same behaviour as api/_audit.js, but durable storage via Postgres (works on Vercel).
 * Sampler runs via:
 *   - Vercel Cron → GET /api/audit/sample (daily on Hobby; every minute needs Pro)
 *   - Manual renew → POST /api/audit/sample (Audit page “Renew now”)
 *   - start() interval when used from server.js / Render with Supabase configured
 */
import { fetchBodsFeed, normalise } from "./siri";
import * as sb from "./supabase";

const TFL_KEY = (process.env.TFL_API_KEY || "").trim() || "37ac7c834d654d80b34696ee7366f32e";
const DVLA_KEY = (process.env.DVLA_API_KEY || "").trim();
const DAY_START = 6, DAY_END = 18;
const LONDON = { lat: 51.5072, lng: -0.1276 };
const WET_CODES = new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99]);

function londonNow() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const get = t => (parts.find(p => p.type === t) || {}).value || "00";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) % 24 };
}

function metres(a, b) {
  const dx = (a.lng - b.lng) * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180);
  const dy = a.lat - b.lat;
  return Math.sqrt(dx * dx + dy * dy) * 111320;
}

function euroFromYear(year) {
  if (!year) return null;
  if (year >= 2014) return "VI";
  if (year >= 2009) return "V";
  if (year >= 2006) return "IV";
  if (year >= 2001) return "III";
  return "II";
}

function yearFromPlate(reg) {
  const m = reg.match(/^[A-Z]{2}(\d{2})[A-Z]{3}$/);
  if (!m) return null;
  const n = Number(m[1]);
  const year = n >= 50 ? 2000 + (n - 50) : 2000 + n;
  return year >= 2001 && year <= new Date().getFullYear() ? year : null;
}

async function loadCampaigns() {
  const rows = await sb.rest.get("audit_campaigns", { select: "*", order: "created_at.asc" });
  return (rows || []).map(r => ({
    id: r.id,
    name: r.name,
    start: r.start_date,
    end: r.end_date,
    registrations: r.registrations || [],
    createdAt: r.created_at,
  }));
}

function activeRegsFrom(campaigns) {
  const now = Date.now();
  const set = new Set();
  campaigns.forEach(c => {
    const s = new Date(c.start + "T00:00:00").getTime();
    const e = new Date(c.end + "T23:59:59").getTime();
    if (now >= s && now <= e) c.registrations.forEach(r => set.add(normalise(r)));
  });
  return set;
}

async function loadActivityMap() {
  const rows = await sb.rest.get("audit_activity", { select: "*" });
  const activity = {};
  for (const r of rows || []) {
    activity[r.registration] = activity[r.registration] || {};
    activity[r.registration][r.day] = { dm: r.dm, ds: r.ds, nm: r.nm, ns: r.ns, km: Number(r.km) || 0 };
  }
  return activity;
}

async function loadVehiclesMap() {
  const rows = await sb.rest.get("audit_vehicles", { select: "*" });
  const vehicles = {};
  for (const r of rows || []) {
    vehicles[r.registration] = {
      euro: r.euro,
      euroSource: r.euro_source,
      fuel: r.fuel,
      year: r.year,
      make: r.make || "",
      note: r.note || undefined,
      checkedAt: r.checked_at,
    };
  }
  return vehicles;
}

async function loadWeatherMap() {
  const rows = await sb.rest.get("audit_weather", { select: "*" });
  const weather = {};
  for (const r of rows || []) {
    weather[r.day] = { n: r.n, wet: r.wet, dayN: r.day_n, dayWet: r.day_wet, tempSum: Number(r.temp_sum) || 0 };
  }
  return weather;
}

async function loadSampler() {
  const rows = await sb.rest.get("audit_sampler", { select: "*", id: "eq.1" });
  const r = (rows && rows[0]) || {};
  return {
    running: r.running !== false,
    lastSampleAt: r.last_sample_at || null,
    lastError: r.last_error || null,
    tracked: r.tracked || 0,
    seenBods: r.seen_bods || 0,
    seenTfl: r.seen_tfl || 0,
    intervalMinutes: Number(r.interval_minutes) || 1,
    startedAt: r.started_at || null,
    dvlaEnabled: !!DVLA_KEY,
    weatherSource: "open-meteo.com",
    lastWeather: r.last_weather || null,
    host: r.host || "supabase",
    storage: "supabase",
  };
}

async function patchSampler(fields) {
  const body = {};
  if ("running" in fields) body.running = fields.running;
  if ("lastSampleAt" in fields) body.last_sample_at = fields.lastSampleAt;
  if ("lastError" in fields) body.last_error = fields.lastError;
  if ("tracked" in fields) body.tracked = fields.tracked;
  if ("seenBods" in fields) body.seen_bods = fields.seenBods;
  if ("seenTfl" in fields) body.seen_tfl = fields.seenTfl;
  if ("intervalMinutes" in fields) body.interval_minutes = fields.intervalMinutes;
  if ("startedAt" in fields) body.started_at = fields.startedAt;
  if ("lastWeather" in fields) body.last_weather = fields.lastWeather;
  if ("lastWeatherAt" in fields) body.last_weather_at = fields.lastWeatherAt;
  if ("host" in fields) body.host = fields.host;
  if (!Object.keys(body).length) return;
  await sb.rest.patch("audit_sampler", { id: "eq.1" }, body, "return=minimal");
}

async function getLastPos(reg) {
  const rows = await sb.rest.get("audit_last_pos", { select: "lat,lng", registration: `eq.${reg}` });
  const r = rows && rows[0];
  return r ? { lat: r.lat, lng: r.lng } : null;
}

async function setLastPos(reg, pos) {
  await sb.rest.upsert("audit_last_pos", {
    registration: reg,
    lat: pos.lat,
    lng: pos.lng,
    updated_at: new Date().toISOString(),
  }, "registration");
}

async function loadAllLastPos() {
  const rows = await sb.rest.get("audit_last_pos", { select: "registration,lat,lng" });
  const map = new Map();
  for (const r of rows || []) map.set(r.registration, { lat: r.lat, lng: r.lng });
  return map;
}

async function enrichVehicle(reg, existing) {
  reg = normalise(reg);
  if (!reg || (existing && existing[reg])) return null;
  let info = null;
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
          euroSource: d.euroStatus ? "dvla" : (year ? "dvla-year" : "assumed"),
          fuel: d.fuelType || "DIESEL",
          year, make: d.make || "",
          checkedAt: new Date().toISOString(),
        };
      } else if (r.status === 404) {
        info = { euro: "VI", euroSource: "assumed", fuel: "DIESEL", year: null, make: "", note: "Not found in DVLA VES", checkedAt: new Date().toISOString() };
      }
    } catch { /* fall through */ }
  }
  if (!info) {
    const year = yearFromPlate(reg);
    info = {
      euro: euroFromYear(year) || "VI",
      euroSource: year ? "plate-year" : "assumed",
      fuel: "DIESEL", year, make: "",
      checkedAt: new Date().toISOString(),
    };
  }
  await sb.rest.upsert("audit_vehicles", {
    registration: reg,
    euro: info.euro,
    euro_source: info.euroSource,
    fuel: info.fuel,
    year: info.year,
    make: info.make || "",
    note: info.note || null,
    checked_at: info.checkedAt,
  }, "registration");
  return info;
}

async function enrichAll(regs) {
  const existing = await loadVehiclesMap();
  for (const reg of regs) {
    await enrichVehicle(reg, existing);
    if (DVLA_KEY) await new Promise(r => setTimeout(r, 250));
  }
}

async function sampleWeather(date, day, lastPosMap, samplerRow) {
  const lastAt = samplerRow && samplerRow.last_weather_at ? Date.parse(samplerRow.last_weather_at) : 0;
  if (Date.now() - lastAt < 15 * 60000) return null;
  try {
    const pts = [...lastPosMap.values()];
    const c = pts.length
      ? { lat: pts.reduce((a, p) => a + p.lat, 0) / pts.length, lng: pts.reduce((a, p) => a + p.lng, 0) / pts.length }
      : LONDON;
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${c.lat.toFixed(3)}&longitude=${c.lng.toFixed(3)}&current=temperature_2m,precipitation,weather_code`);
    if (!r.ok) throw new Error(`open-meteo ${r.status}`);
    const d = await r.json();
    const cur = d.current || {};
    const wet = WET_CODES.has(Number(cur.weather_code)) || Number(cur.precipitation) > 0;
    await sb.rpc("audit_bump_weather", {
      p_day: date,
      p_wet: wet,
      p_daytime: day,
      p_temp: Number(cur.temperature_2m) || 0,
    });
    const lastWeather = { at: new Date().toISOString(), temp: cur.temperature_2m, wet, code: cur.weather_code, lat: c.lat, lng: c.lng };
    await patchSampler({ lastWeather, lastWeatherAt: new Date().toISOString() });
    return lastWeather;
  } catch (err) {
    await patchSampler({ lastError: "weather: " + (err.message || err) });
    return null;
  }
}

async function sample() {
  if (!sb.configured()) throw new Error("Supabase is not configured");
  const campaigns = await loadCampaigns();
  const regs = activeRegsFrom(campaigns);
  const { date, hour } = londonNow();
  const day = hour >= DAY_START && hour < DAY_END;
  const lastPosMap = await loadAllLastPos();
  const samplerRows = await sb.rest.get("audit_sampler", { select: "*", id: "eq.1" });
  const samplerRow = (samplerRows && samplerRows[0]) || {};

  await patchSampler({
    tracked: regs.size,
    lastSampleAt: new Date().toISOString(),
    seenBods: 0,
    seenTfl: 0,
    running: true,
    host: "supabase",
  });

  if (regs.size) await sampleWeather(date, day, lastPosMap, samplerRow);
  if (!regs.size) {
    await patchSampler({ lastError: null });
    return { ok: true, tracked: 0, seenBods: 0, seenTfl: 0 };
  }

  const seen = new Set();
  let seenBods = 0, seenTfl = 0, lastError = null;

  try {
    const feed = await fetchBodsFeed();
    for (const v of feed) {
      const r1 = normalise(v.registration), r2 = normalise(v.vehicleRef);
      let reg = null;
      if (r1 && regs.has(r1) && !seen.has(r1)) reg = r1;
      else if (r2 && regs.has(r2) && !seen.has(r2)) reg = r2;
      if (!reg) continue;
      seen.add(reg);
      seenBods++;
      const pos = { lat: v.latitude, lng: v.longitude };
      const prev = lastPosMap.get(reg);
      const dist = prev ? metres(pos, prev) : 0;
      const moving = v.speed > 1 || dist > 40;
      lastPosMap.set(reg, pos);
      await setLastPos(reg, pos);
      const bump = { p_registration: reg, p_day: date, p_dm: 0, p_ds: 0, p_nm: 0, p_ns: 0, p_km: 0 };
      if (day) { if (moving) bump.p_dm = 1; else bump.p_ds = 1; }
      else { if (moving) bump.p_nm = 1; else bump.p_ns = 1; }
      if (dist > 0 && dist < 2000) bump.p_km = dist / 1000;
      await sb.rpc("audit_bump_activity", bump);
    }
  } catch (err) {
    lastError = "BODS: " + (err.message || err);
  }

  const missing = [...regs].filter(r => !seen.has(r));
  for (let i = 0; i < missing.length; i += 25) {
    const ids = missing.slice(i, i + 25);
    try {
      const r = await fetch(`https://api.tfl.gov.uk/Vehicle/${encodeURIComponent(ids.join(","))}/Arrivals?app_key=${TFL_KEY}`);
      if (!r.ok) continue;
      const preds = await r.json();
      const found = new Set((Array.isArray(preds) ? preds : []).map(p => normalise(String(p.vehicleId || ""))).filter(Boolean));
      for (const reg of found) {
        if (!regs.has(reg) || seen.has(reg)) continue;
        seen.add(reg);
        seenTfl++;
        const bump = { p_registration: reg, p_day: date, p_dm: 0, p_ds: 0, p_nm: 0, p_ns: 0, p_km: 0 };
        if (day) bump.p_dm = 1; else bump.p_nm = 1;
        await sb.rpc("audit_bump_activity", bump);
      }
    } catch { /* skip chunk */ }
  }

  await patchSampler({
    seenBods,
    seenTfl,
    lastError,
    tracked: regs.size,
    lastSampleAt: new Date().toISOString(),
  });

  return { ok: true, tracked: regs.size, seenBods, seenTfl, lastError };
}

async function summary() {
  if (!sb.configured()) {
    return {
      ok: false,
      error: "Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
      campaigns: [], activity: {}, vehicles: {}, weather: {},
      sampler: { running: false, storage: "unconfigured" },
      dayWindow: { start: DAY_START, end: DAY_END, timezone: "Europe/London" },
    };
  }
  const [campaigns, activity, vehicles, weather, sampler] = await Promise.all([
    loadCampaigns(), loadActivityMap(), loadVehiclesMap(), loadWeatherMap(), loadSampler(),
  ]);
  return {
    ok: true,
    campaigns,
    activity,
    vehicles,
    weather,
    sampler,
    dayWindow: { start: DAY_START, end: DAY_END, timezone: "Europe/London" },
    storage: "supabase",
  };
}

async function addCampaign(input) {
  const name = String(input.name || "").trim().slice(0, 80);
  const start = String(input.start || "").slice(0, 10);
  const end = String(input.end || "").slice(0, 10);
  const registrations = [...new Set((Array.isArray(input.registrations) ? input.registrations : []).map(normalise).filter(Boolean))].slice(0, 300);
  if (!name || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || !registrations.length) {
    return { error: "A campaign name, valid start and end dates, and at least one registration are required" };
  }
  if (end < start) return { error: "The end date is before the start date" };
  const campaign = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name,
    start,
    end,
    registrations,
    createdAt: new Date().toISOString(),
  };
  await sb.rest.post("audit_campaigns", {
    id: campaign.id,
    name: campaign.name,
    start_date: campaign.start,
    end_date: campaign.end,
    registrations: campaign.registrations,
    created_at: campaign.createdAt,
  });
  enrichAll(registrations).catch(() => {});
  return { campaign };
}

async function removeCampaign(id) {
  if (!id) return false;
  await sb.rest.del("audit_campaigns", { id: `eq.${id}` });
  return true;
}

let timer = null;
function start(intervalMs = 60000) {
  if (timer || !sb.configured()) return;
  patchSampler({
    running: true,
    startedAt: new Date().toISOString(),
    intervalMinutes: intervalMs / 60000,
    host: process.env.VERCEL ? "vercel-interval" : "node",
  }).catch(() => {});
  timer = setInterval(() => { sample().catch(err => { patchSampler({ lastError: String(err.message || err) }).catch(() => {}); }); }, intervalMs);
  sample().catch(err => { patchSampler({ lastError: String(err.message || err) }).catch(() => {}); });
  loadCampaigns().then(cs => {
    const regs = [...new Set(cs.flatMap(c => c.registrations.map(normalise)))];
    return enrichAll(regs);
  }).catch(() => {});
}

export { summary, addCampaign, removeCampaign, sample, start, enrichAll };
export const configured = sb.configured;
