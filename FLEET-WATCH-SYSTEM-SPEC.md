# Fleet Watch — complete system specification (LLM handoff)

Audience: an AI model or engineer with zero prior context. This document describes the entire product: purpose, architecture, every file, every data shape, every external API, the estimation formulas with exact constants, deployment, and known limitations. Read it top to bottom and you can reconstruct or extend the system without seeing the conversation that produced it.

---

## 1. What this product is

Fleet Watch is an **independent proof-of-play and audit system for moving out-of-home (OOH) advertising** — specifically adverts printed on the sides of buses. An advertiser buys a campaign: a set of buses carry a given advert ("wrap") for a contracted period. Fleet Watch answers, from neutral public data, three questions the advertiser otherwise takes on trust:

1. **Where are my advertised buses right now?** (live tracking, per brand)
2. **Did they actually run — how many hours, moving vs idle, day vs night, over the campaign?** (audit)
3. **What did that deliver and cost the planet?** (estimated audience impressions + estimated CO2, with weather and data-completeness context)

The strategic position: media owners self-report bus-advert delivery; Fleet Watch is the *independent auditor* built on government open data. It is the general shape of "the measurement layer for moving OOH" — the role the body 'Route' plays for static billboards, which nobody fills for buses.

It is owned/branded by **MPC (Media Photography Company)**, an OOH campaign photography studio; the visual identity is MPC's design system (section 9).

---

## 2. External data sources (the whole dependency surface)

| Source | Auth | Called from | Purpose | CORS (browser-callable)? |
|---|---|---|---|---|
| **TfL Unified API** (`api.tfl.gov.uk`) | `app_key` query param (free) | Browser directly AND server | London bus/tube/cycle/air/road live data. Bus positions come as *next-stop predictions* per registration, resolved to coordinates via StopPoint. | **Yes** — key is embedded in the HTML pages |
| **BODS** — Bus Open Data Service, DfT (`data.bus-data.dft.gov.uk/api/v1/datafeed/`) | `api_key` query param (free) | **Server only** | England-wide bus GPS as SIRI-VM XML. Exact lat/lng + speed + bearing. | **No** — no CORS; browsers cannot call it. Must be relayed server-side. This is the single most important architectural constraint. |
| **DVLA Vehicle Enquiry Service (VES)** | `x-api-key` header (free, register) | Server only, optional | Per-registration Euro emissions status, year, make, fuel. | No |
| **Open-Meteo** (`api.open-meteo.com`) | None (keyless, free) | Server (audit sampler) | Current weather (temp, precipitation, weather_code) at the fleet's live centre. | Yes |
| **Supabase** (Postgres) | `service_role` key (server only) | Server (audit + watchlists) | Durable campaign audit + optional watchlists on Vercel | No (server-side REST) |
| **OpenFreeMap** (`tiles.openfreemap.org/styles/liberty`) | None | Browser (MapLibre) | Vector map tiles. | Yes |
| **MapLibre GL 5.13, Chart.js 4.4.1** | None | Browser (CDN: unpkg / cloudflare) | Map rendering, charts. | Yes |

### API keys (as configured in this build)
- `BODS_API_KEY` — server-side env var; a fallback copy may exist in `api/_siri.js`. Prefer env.
- `TFL_API_KEY` — embedded client-side in HTML (`const TFL_KEY`/`const KEY`), and server-side in audit modules. TfL permits browser use.
- `DVLA_API_KEY` — optional; register free at developer-portal.driver-vehicle-licensing.api.gov.uk.
- `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` — required for audit/watchlists on Vercel. See `.env.example`.
- `CRON_SECRET` — protects `/api/audit/sample` (Vercel Cron / external cron).

All free-tier keys shared in plaintext during development should be rotated before any public launch.

---

## 3. Architecture (single form)

Static HTML + zero-dependency Node / Vercel serverless. No Next.js, no Cloudflare Workers, no npm build.

- Pages: `index.html`, `landing.html`, `api-proof.html`, `network-insights.html`, `campaign-audit.html`
- Local / Render: `server.js` or `fleet-watch-local.js`
- Vercel: `api/*.js` serverless + Supabase for durable audit
- Schema: `supabase/schema.sql`

---

## 4. The pages

All share the MPC look, a top nav, and a green "LIVE" flag. When served from `file://` they run TfL-only; when served by the Node server / Vercel they get BODS (and audit when Supabase or the in-process sampler is available).

### 4.1 `index.html` — the dashboard
- **Purpose:** live campaign map. Upload a CSV of registrations + adverts; watch the matched buses move; toggle brands on/off.
- **CSV parsing:** registration column matched by regex `/registration|plate|vrn/`; brand/advert column by `/advert|brand|campaign|creative|client|name/`; optional label `/label|description|note/`, operator `/operator|company/`. Registrations normalised (see §6). If no header row is detected, row 0 is treated as data.
- **Brand system:** each distinct advert/brand gets a stable colour from a fixed 12-colour palette (first colour is MPC accent `#ff3355`). Sidebar shows a pill per brand with live/total counts; click toggles visibility; All/None shortcuts. Hidden brands are filtered from map + list.
- **Map:** MapLibre + OpenFreeMap. One marker per matched vehicle, coloured by brand, arrow rotated to bearing. Rollover shows an enlarged number-plate label ("REG · Brand"); the plate grows on hover (a stated requirement). Legend lists active brands.
- **Live data:** every 10s it (a) queries TfL `Vehicle/{regs}/Arrivals` per registration, takes the soonest prediction, resolves its `naptanId` to coords via `StopPoint`; (b) if served over http(s), also calls `/api/bods` (the relay) for exact GPS and **overrides** the TfL next-stop position with real GPS where both exist. Detail panel labels the source: "BODS · GPS" (speed, heading) vs "TFL · LIVE" (next stop, countdown).
- **Sample data:** a "Load sample campaign" action loads 8 example registrations across 4 brands. When active, a pink "SAMPLE DATA" badge shows and the notice explains the registrations are examples (positions are still real lookups). Importing a real CSV clears it. State persists in `localStorage` key `fw-preview`.

### 4.2 `api-proof.html` — provenance / proof the APIs are live
- **Endpoint directory:** a table of every endpoint the project can reach; on load it live-checks each (HTTP status + round-trip ms + LIVE/FAIL tag). BODS row is checked via `/api/bods/health` when served by the server, else shows "RUN LOCAL SERVER".
- **Vehicle inventory:** "Load every live vehicle" calls TfL `Mode/bus/Arrivals` (all predictions on the network), dedupes to unique `vehicleId`s (typically 6–8k), shows counts + a searchable table with yellow plates.
- **Plot all:** places the 800 soonest-arriving vehicles at their next stops on a map (batch-resolving stop coords).
- **Direct lookup:** type a registration → raw `Vehicle/{reg}/Arrivals` JSON + a plotted marker.
- Everything here is live; there is no sample data.

### 4.3 `network-insights.html` — the wider network (radical/insightful angle)
- Live TfL dashboards beyond buses, via Chart.js: **tube line status** board (official line colours), **cycle hire** totals + standard/e-bike/empty doughnut, **air quality** current+tomorrow bands, **road corridor** disruption tally, and a "bus network pulse" that charts the busiest routes and an arrival-countdown histogram across every live vehicle.

### 4.4 `campaign-audit.html` — proof of play (the flagship)
- **Purpose:** register a campaign (name, start date, end date, registrations) and audit how long each bus runs vs sits idle, day vs night, plus impressions, carbon, weather and data confidence. Generates a printable PDF certificate.
- **Requires Supabase (Vercel) or the Node sampler (`server.js`).** If `/api/audit` is unreachable it shows a clear warning.
- Reads `/api/audit` every 60s and renders: a headline stat block, a daily stacked hours chart, a day/night doughnut, and a per-bus table. Also POSTs new campaigns and DELETEs them.
- **Report:** "Download proof-of-play report" builds a hidden white-paper report DOM (charts converted to images via `chart.toBase64Image()`) and calls `window.print()`.

---

## 5. The servers and API contract

Entry points:
- `server.js` — local / Render (static + BODS + audit). Default port `process.env.PORT || 8017`.
- `fleet-watch-local.js` — local convenience server (same idea).
- Vercel — static files + `api/*.js` serverless.

Shared / serverless modules (all under `api/`):
- `_siri.js` — BODS fetch + SIRI-VM parse + 20s cache
- `_audit.js` — file-backed sampler (local/Render without Supabase)
- `_audit-sb.js` + `_supabase.js` — Supabase-backed audit
- `bods.js`, `bods/health.js`, `audit.js`, `audit/campaigns.js`, `audit/sample.js`, `watchlist.js`

### HTTP endpoints
```
GET  /                         → index.html (dashboard)
GET  /api/bods?registrations=A,B,C
GET  /api/bods/health
GET  /api/audit                → full audit summary (see §7 shape)
POST /api/audit/campaigns      body { name, start, end, registrations:[..] }
DELETE /api/audit/campaigns?id=<id>
GET|POST /api/audit/sample     → run one minute sample (cron; protect with CRON_SECRET)
GET|POST|DELETE /api/watchlist → optional fleet persistence (Supabase)
GET  /<anystaticfile>          → served from the folder
```

### Vercel
- Framework **Other** (`vercel.json` → `"framework": null`)
- BODS functions: `maxDuration: 60`, 1024MB
- Audit cron: `* * * * *` → `/api/audit/sample` (Pro for minute; Hobby needs external cron)
- Persistence: Supabase (`supabase/schema.sql`)

---

## 6. Core shared logic (identical across implementations)

**Registration normalisation** (the join key everywhere):
```
normalise(v) = v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12)
```

**SIRI-VM parse** (`_siri.js` / `transit.ts`): regex-extract each `<VehicleActivity>`; pull `Longitude, Latitude, VehicleRef, Velocity, RecordedAtTime, Bearing, VehicleRegistrationNumber|Registration, OperatorRef, PublishedLineName|LineRef, DestinationName|DestinationRef, DirectionRef`. Namespace prefixes are tolerated. A vehicle is emitted only if lat, lng and vehicleRef are present. `status`: stale if recordedAt older than 180s, else moving if speed>1 else stopped. BODS matching filters parsed vehicles to the requested registration set (matching either the registration or the vehicleRef).

**Vehicle object shape** (both feeds normalise to this):
```
{ id, registration, vehicleRef, operator, route, destination, direction,
  latitude, longitude, bearing, speed, recordedAt, receivedAt,
  source: "bods"|"tfl"|"demo", status: "moving"|"stopped"|"stale",
  locationQuality: "gps"|"next-stop" }
```
BODS → `locationQuality:"gps"`; TfL → `"next-stop"` (positioned at the predicted stop).

**TfL matching:** `Vehicle/{regs}/Arrivals` returns predictions; keep the soonest per vehicle; resolve `naptanId`→coords via `StopPoint`. In the audit, a TfL-only match counts the bus as on-road and moving (no GPS distance available).

---

## 7. The audit engine (`api/_audit.js`) — the heart of the product

Runs one **sample per minute** (in-process via `server.js`, or via `/api/audit/sample` cron on Vercel). Persists to Supabase when configured, otherwise to `audit-data.json` locally.

### Persisted state shape (returned by `GET /api/audit` under these keys)
```
campaigns: [ { id, name, start:"YYYY-MM-DD", end:"YYYY-MM-DD",
               registrations:[normalised], createdAt } ]
activity:  { [reg]: { [date]: { dm, ds, nm, ns, km } } }
             // minutes: day-moving, day-idle, night-moving, night-idle; km travelled that day
vehicles:  { [reg]: { euro, euroSource, fuel, year, make, checkedAt } }
             // euroSource ∈ "dvla" | "dvla-year" | "plate-year" | "assumed"
weather:   { [date]: { n, wet, dayN, dayWet, tempSum } }
sampler:   { running, lastSampleAt, lastError, tracked, seenBods, seenTfl,
             intervalMinutes, startedAt, dvlaEnabled, weatherSource, lastWeather }
dayWindow: { start:6, end:18, timezone:"Europe/London" }
```

### The minute sample (`sample()`)
1. Compute active registrations = union of registrations across campaigns whose [start,end] contains now.
2. Determine London date + hour (`Intl.DateTimeFormat` timezone Europe/London). **Day = 06:00–18:00**, else night.
3. Every 15 min, sample weather (§7.3).
4. Fetch BODS feed (cached 20s). For each active reg found: classify **moving** if `speed>1` OR it moved >40 m since last sample; increment the right bucket (`dm/ds/nm/ns`); add distance to `km` (ignoring GPS jumps >2000 m/min). Count as `seenBods`.
5. For active regs NOT seen in BODS, batch-query TfL `Vehicle/{ids}/Arrivals`; any that return predictions count as on-road+moving (`dm` or `nm`), `seenTfl`.
6. Regs seen in neither are simply not incremented that minute (→ read as off-road).

### 7.1 Emissions class enrichment (`enrichVehicle`)
On campaign creation / server start, for each registration:
- If `DVLA_API_KEY` set → POST DVLA VES; store real `euroStatus` (source `dvla`) or derive from year (`dvla-year`); 404 → assumed Euro VI.
- Else → estimate from the plate's year identifier (UK current-format plate `^[A-Z]{2}(\d{2})[A-Z]{3}$`, digits→year), map year→Euro via `euroFromYear` (source `plate-year`).
- Else → assumed Euro VI (London LEZ standard).
```
euroFromYear: >=2014→VI, >=2009→V, >=2006→IV, >=2001→III, else II
```

### 7.2 Estimation formulas and EXACT constants (defined client-side in campaign-audit.html)
```
KM_FACTOR   = { VI:1.05, V:1.2, IV:1.3, III:1.4, II:1.45 }  // kg CO2 per km, by Euro class
IDLE_KG_PER_MIN = 0.11                                       // kg CO2 per idle minute
CONTACTS_PER_KM = 210                                        // audience contacts per km, full wrap
NIGHT_FACTOR    = 0.35                                       // night reach vs day
URBAN_SPEED_KMH = 14                                         // fallback for TfL-only buses (no GPS km)

// per bus, over the campaign window:
kmEff        = km>0 ? km : ((dm+nm)/60)*14
CO2_kg       = electric ? 0 : kmEff*KM_FACTOR[euro] + (ds+ns)*IDLE_KG_PER_MIN
dayKm        = km>0 ? km*(dm/(dm+nm)) : (dm/60)*14
nightKm      = km>0 ? km*(nm/(dm+nm)) : (nm/60)*14
impressions  = (dayKm + nightKm*NIGHT_FACTOR) * CONTACTS_PER_KM

// capture confidence (data completeness):
confidence%  = 100 * (campaign days with ≥1 reporting bus) / (elapsed campaign days)
```
**These factors are conservative placeholders, explicitly labelled as estimates in the UI.** For a certified figure, replace `CONTACTS_PER_KM` (ideally per road segment, from DfT traffic counts / Route methodology) and the CO2 factors (DEFRA/DfT emission factors). They are isolated as named constants precisely so they can be swapped.

### 7.3 Weather (`sampleWeather`) — keyless
Every 15 min, call Open-Meteo `current=temperature_2m,precipitation,weather_code` at the mean lat/lng of currently-tracked buses (fallback London centre). "Wet" if weather_code ∈ the WMO precipitation set OR precipitation>0. Accumulate per date into `{n, wet, tempSum}`. Report shows dry% and average temp over the campaign window.

---

## 8. The proof-of-play PDF report
Generated client-side in `campaign-audit.html` by `buildReport()` → `window.print()`. Contents: MPC-branded header (logo + campaign name + dates + generated timestamp), a 12-cell stat grid (vehicles, days audited, hours on road, est impressions, moving %, idle %, night %, distance, est CO2, dry weather %, avg temp, capture confidence), the two charts as embedded images, a plain-English **Method** paragraph (states what is measured vs estimated, and that capture gaps mean server downtime not idle buses), and the full per-vehicle table (plate, Euro class, on-road/moving/idle hours, km, impressions, CO2). Print CSS: A4, hides the live app, white background, avoids row splits across pages. Deliverable = the thing an account manager forwards to a client.

---

## 9. MPC design system (visual identity — apply to anything new)
- **Palette (only these):** black `#0a0a0a`, panel `#131314`, paper `#f2efe9`, muted `#b8b5ae`, grey `#8b8b88`, line `rgba(242,239,233,.14)`, and one accent `#ff3355` (light-trail pink-red). Light theme swaps neutrals only; accent never changes. Never pure `#000`/`#fff`.
- **Type:** Anton (display, uppercase, condensed, poster-scale, `letter-spacing:.015em`, `line-height:.95`) for every heading/number/label; Inter at weight 300 for body. Never set a sentence in Anton.
- **Signature type treatment:** filled / outlined (`-webkit-text-stroke`) / photo-filled display type; hover transitions to accent over .35s.
- **Structure:** sharp corners (radius 0), rules not boxes (1px `--line` borders), full-bleed photography leads (greyscale at rest, colour on attention), film grain + vignette + accent bloom overlays. One easing curve everywhere: `cubic-bezier(.16,1,.3,1)`; sections rise/settle on entry; no bounce.
- **Data-colour exception (functional):** the multi-brand marker/pill palette uses distinct colours beyond the single accent — the only sanctioned use of non-accent colour, because it encodes data. First brand always takes `#ff3355`; all UI chrome stays strictly on the accent.
- Full spec: `MPC-Design-System.md`; palette: `mpc-colours.css`; font: `public/fonts/Anton-Regular.ttf`; logo: `public/assets/media-photography-logo.webp`.

---

## 10. File map
```
fleet-watch/
├─ index.html, landing.html, api-proof.html, network-insights.html, campaign-audit.html
├─ public/fonts/Anton-Regular.ttf, public/assets/*
├─ server.js, fleet-watch-local.js
├─ api/_siri.js, api/_audit.js, api/_audit-sb.js, api/_supabase.js
├─ api/bods.js, api/bods/health.js
├─ api/audit.js, api/audit/campaigns.js, api/audit/sample.js
├─ api/watchlist.js
├─ supabase/schema.sql
├─ package.json, vercel.json, .env.example
└─ README.md, README-DEPLOY.md, DEVELOPER-INSTRUCTIONS.md, FLEET-WATCH-SYSTEM-SPEC.md
```

---

## 11. Deployment

| Target | What works | Setup |
|---|---|---|
| **Local** (`node server.js`) | Everything | Node ≥18; optional Supabase env or file-backed audit |
| **Render** | Everything | `node server.js`, env `BODS_API_KEY` (+ optional Supabase / `DVLA_API_KEY`) |
| **Vercel** | Everything incl. audit | Framework Other; env `BODS_API_KEY`, `SUPABASE_*`, `CRON_SECRET`; run `supabase/schema.sql`; minute cron or external cron |
| **`file://`** | TfL-only pages | No BODS, no audit |

The BODS relay must run server-side (no CORS). The audit needs either an always-on sampler (`server.js`) or Supabase + cron (`/api/audit/sample`).

---

## 12. Known limitations / integrity notes (state these to any stakeholder)
- **Audit only records while the server runs.** Downtime reads as buses off-road. `captureConfidence` surfaces this honestly; it is not hidden.
- **Impressions and CO2 are estimates on placeholder factors** (§7.2), labelled as such. Not a certified methodology until the constants are replaced with DfT/DEFRA/Route-grounded values.
- **Emissions class is estimated from the plate year** unless a DVLA key is supplied (then verified, badge turns green).
- **TfL positions are next-stop predictions**, not GPS; BODS positions are true GPS and override TfL where both exist. Outside London, only BODS covers a bus.
- **Keys were shared in plaintext**; rotate before launch. The TfL key is intentionally client-visible (permitted); BODS/DVLA keys must stay server-side.
- **Two codebases** (Next app vs standalone) are not automatically in sync; audit/insights/proof/impressions/carbon/weather currently live only in the standalone form.

---

## 13. Roadmap (identified 6→10 levers, in priority order)
1. **Impressions → media currency** (done as an estimate; upgrade to per-segment DfT traffic-count grounding for certification).
2. **Report as deliverable** (done; next: embed MPC's actual wrap photograph per campaign = "proof it looked right + proof it ran").
3. **Trust/defensibility** (capture confidence done; add DEFRA-grounded CO2, and tamper-evidence e.g. daily log hashing).
4. **Operational alerting** (not built): notify when a wrapped bus hasn't reported for N hours or is below contracted hours → SLA enforcement.
5. **Multi-advertiser accounts** (not built): scoping so each client sees only their campaigns.
6. **Photographer-dispatch view** (not built, MPC-unique): predict when/where a wrapped bus hits golden-hour landmarks to schedule shoots.

Adjacent open-data extensions that reuse the same engine: GBFS (dockless bikes/scooters worldwide), GTFS-RT (any city's live vehicles), National Rail Darwin (trains), DVLA/DVSA (vehicle validation), Met Office/Open-Meteo (weather, done). The generalised product = *ingest open vehicle telemetry, bind it to a commercial contract, audit reality against the promise.*
```
```
