import { addCampaign, configured, ensureSampling, removeCampaign } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  if (!configured()) {
    return Response.json(
      {
        ok: false,
        error:
          "Audit store not configured. Locally it works automatically; on Vercel set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
      },
      { status: 503 },
    );
  }
  try {
    await ensureSampling();
    const body = await request.json();
    const result = await addCampaign(body || {});
    return Response.json(result, { status: result.error ? 400 : 201 });
  } catch (err) {
    return Response.json(
      { ok: false, error: String(err instanceof Error ? err.message : err) },
      { status: 502 },
    );
  }
}

export async function DELETE(request: Request) {
  if (!configured()) {
    return Response.json(
      {
        ok: false,
        error:
          "Audit store not configured. Locally it works automatically; on Vercel set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
      },
      { status: 503 },
    );
  }
  try {
    const id = new URL(request.url).searchParams.get("id") || "";
    const removed = await removeCampaign(id);
    return Response.json({ ok: removed }, { status: removed ? 200 : 404 });
  } catch (err) {
    return Response.json(
      { ok: false, error: String(err instanceof Error ? err.message : err) },
      { status: 502 },
    );
  }
}
