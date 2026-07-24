import { fetchBodsFeed } from "@/lib/siri";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    const all = await fetchBodsFeed();
    return Response.json(
      { ok: true, connected: true, totalUpstream: all.length, checkedAt: new Date().toISOString() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return Response.json(
      { ok: false, connected: false, error: String(err instanceof Error ? err.message : err) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
