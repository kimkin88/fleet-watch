import { fetchBustimesPositions } from "@/lib/bustimes";
import {
  bodsFeedMeta,
  bodsMatchKeys,
  fetchBodsFeed,
  matchBodsToRegistrations,
  MatchedBodsVehicle,
  normalise,
} from "@/lib/siri";
import type { BustimesVehicle } from "@/lib/bustimes";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type LiveVehicle = MatchedBodsVehicle | BustimesVehicle;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const requested = String(searchParams.get("registrations") || "")
      .split(",")
      .map(normalise)
      .filter(Boolean);
    const search = normalise(searchParams.get("q") || "");
    const all = await fetchBodsFeed();
    const meta = bodsFeedMeta();

    if (search) {
      const vehicles = all
        .filter((v) => bodsMatchKeys(v).some((key) => key.includes(search)))
        .slice(0, 50);
      return Response.json(
        {
          ok: true,
          connected: true,
          stale: meta.stale,
          totalUpstream: all.length,
          matched: vehicles.length,
          requested: 0,
          search,
          missing: [],
          vehicles,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    let vehicles: LiveVehicle[] = [];
    let missing: string[] = [];
    let bustimesCount = 0;

    if (requested.length) {
      const matched = matchBodsToRegistrations(all, requested);
      vehicles = matched.vehicles;
      missing = matched.missing;

      // Wales / Scotland / gaps: bustimes.org aggregates non-BODS AVL (e.g. Cardiff Bus).
      if (missing.length) {
        try {
          const bt = await fetchBustimesPositions(missing);
          if (bt.vehicles.length) {
            vehicles = [...vehicles, ...bt.vehicles];
            bustimesCount = bt.vehicles.length;
            const found = new Set(bt.vehicles.map((v) => v.matchedRegistration));
            missing = missing.filter((r) => !found.has(r));
          }
        } catch {
          /* BODS-only response is still useful */
        }
      }
    }

    return Response.json(
      {
        ok: true,
        connected: true,
        stale: meta.stale,
        totalUpstream: all.length,
        matched: vehicles.length,
        bodsMatched: vehicles.length - bustimesCount,
        bustimesMatched: bustimesCount,
        requested: requested.length,
        missing,
        vehicles,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return Response.json(
      { ok: false, connected: false, error: String(err instanceof Error ? err.message : err) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
