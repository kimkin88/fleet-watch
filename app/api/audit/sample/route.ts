import { configured, sample } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: Request) {
  const secret = (process.env.CRON_SECRET || "").trim();
  if (!secret) return true;
  const header = request.headers.get("authorization") || "";
  if (header === `Bearer ${secret}`) return true;
  const q = new URL(request.url).searchParams.get("secret") || "";
  return q === secret;
}

async function run(request: Request) {
  if (!authorized(request)) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!configured()) {
    return Response.json({ ok: false, error: "Audit store not configured" }, { status: 503 });
  }
  try {
    const result = await sample();
    return Response.json({ ...result, at: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return Response.json(
      { ok: false, error: String(err instanceof Error ? err.message : err) },
      { status: 502 },
    );
  }
}

export async function GET(request: Request) {
  return run(request);
}

export async function POST(request: Request) {
  return run(request);
}
