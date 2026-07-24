import { configured, ensureSampling, summary } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  if (!configured()) {
    return Response.json(
      {
        ok: false,
        error:
          "Audit store not configured. Locally it works automatically (audit-data.json). On Vercel set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, then run supabase/schema.sql.",
        campaigns: [],
        activity: {},
        vehicles: {},
        weather: {},
        sampler: { running: false, storage: "unconfigured" },
        dayWindow: { start: 6, end: 18, timezone: "Europe/London" },
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  try {
    await ensureSampling();
    const data = await summary();
    return Response.json(data, {
      status: data.ok === false ? 503 : 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    return Response.json(
      { ok: false, error: String(err instanceof Error ? err.message : err) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
