import { fetchBodsFeed, normalise } from "@/lib/siri";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const requested = String(searchParams.get("registrations") || "")
      .split(",")
      .map(normalise)
      .filter(Boolean);
    const requestedSet = new Set(requested);
    let all = requested.length ? await fetchBodsFeed(requested) : await fetchBodsFeed();
    let vehicles = requested.length
      ? all.filter(
          (v) =>
            requestedSet.has(normalise(v.registration)) || requestedSet.has(normalise(v.vehicleRef)),
        )
      : [];
    if (requested.length && !vehicles.length) {
      all = await fetchBodsFeed();
      vehicles = all.filter(
        (v) =>
          requestedSet.has(normalise(v.registration)) || requestedSet.has(normalise(v.vehicleRef)),
      );
    }
    return Response.json(
      {
        ok: true,
        connected: true,
        totalUpstream: all.length,
        matched: vehicles.length,
        requested: requested.length,
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
