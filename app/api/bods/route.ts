import { fetchBodsFeed, normalise } from "@/lib/siri";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const all = await fetchBodsFeed();
    const requested = new Set(
      String(searchParams.get("registrations") || "")
        .split(",")
        .map(normalise)
        .filter(Boolean),
    );
    const vehicles = requested.size
      ? all.filter(
          (v) => requested.has(normalise(v.registration)) || requested.has(normalise(v.vehicleRef)),
        )
      : [];
    return Response.json(
      { ok: true, connected: true, totalUpstream: all.length, matched: vehicles.length, vehicles },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return Response.json(
      { ok: false, connected: false, error: String(err instanceof Error ? err.message : err) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
