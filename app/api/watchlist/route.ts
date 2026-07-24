import { normalise } from "@/lib/siri";
import * as sb from "@/lib/supabase";

export const dynamic = "force-dynamic";

function cleanBrand(value: unknown) {
  return String(value || "").trim().slice(0, 60);
}

async function listAll() {
  const [lists, vehicles] = await Promise.all([
    sb.rest.get("watchlists", { select: "id,name,created_at", order: "id.desc" }) as Promise<
      Array<{ id: number; name: string; created_at: string }>
    >,
    sb.rest.get("watched_vehicles", {
      select: "id,watchlist_id,registration,label,operator,vehicle_ref,source,brand",
      order: "id.asc",
    }) as Promise<
      Array<{
        id: number;
        watchlist_id: number;
        registration: string;
        label: string;
        operator: string;
        vehicle_ref: string;
        source: string;
        brand: string;
      }>
    >,
  ]);
  return {
    watchlists: (lists || []).map((r) => ({ id: r.id, name: r.name, createdAt: r.created_at })),
    vehicles: (vehicles || []).map((r) => ({
      id: r.id,
      watchlistId: r.watchlist_id,
      registration: r.registration,
      label: r.label,
      operator: r.operator,
      vehicleRef: r.vehicle_ref,
      source: r.source,
      brand: r.brand,
    })),
    storage: "supabase" as const,
  };
}

export async function GET() {
  if (!sb.configured()) {
    return Response.json(
      { watchlists: [], vehicles: [], storage: "unavailable", error: "Supabase is not configured" },
      { status: 503 },
    );
  }
  try {
    return Response.json(await listAll(), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return Response.json({ error: String(err instanceof Error ? err.message : err) }, { status: 502 });
  }
}

export async function POST(request: Request) {
  if (!sb.configured()) {
    return Response.json(
      { watchlists: [], vehicles: [], storage: "unavailable", error: "Supabase is not configured" },
      { status: 503 },
    );
  }
  try {
    const body = await request.json();
    const single = body.registration
      ? {
          registration: normalise(String(body.registration)),
          label: String(body.label || "Manual vehicle"),
          operator: String(body.operator || ""),
          vehicleRef: String(body.vehicleRef || ""),
          source: String(body.source || "auto"),
          brand: cleanBrand(body.brand),
        }
      : null;

    if (single) {
      if (!single.registration) return Response.json({ error: "Add a valid registration" }, { status: 400 });
      let lists = (await sb.rest.get("watchlists", {
        select: "id,name,created_at",
        order: "id.desc",
        limit: "1",
      })) as Array<{ id: number; name: string; created_at: string }>;
      let watchlist = lists?.[0];
      if (!watchlist) {
        const created = (await sb.rest.post("watchlists", { name: "Manual fleet" })) as Array<{
          id: number;
          name: string;
          created_at: string;
        }>;
        watchlist = created?.[0];
      }
      if (!watchlist) return Response.json({ error: "Could not create watchlist" }, { status: 500 });
      const existing = (await sb.rest.get("watched_vehicles", {
        select: "id,watchlist_id,registration,label,operator,vehicle_ref,source,brand",
        watchlist_id: `eq.${watchlist.id}`,
        registration: `eq.${single.registration}`,
        limit: "1",
      })) as Array<Record<string, unknown>>;
      if (existing?.[0]) {
        const e = existing[0];
        return Response.json({
          vehicle: {
            id: e.id,
            watchlistId: e.watchlist_id,
            registration: e.registration,
            label: e.label,
            operator: e.operator,
            vehicleRef: e.vehicle_ref,
            source: e.source,
            brand: e.brand,
          },
          storage: "supabase",
          duplicate: true,
        });
      }
      const inserted = (await sb.rest.post("watched_vehicles", {
        watchlist_id: watchlist.id,
        registration: single.registration,
        label: single.label,
        operator: single.operator,
        vehicle_ref: single.vehicleRef,
        source: single.source,
        brand: single.brand,
      })) as Array<Record<string, unknown>>;
      const v = inserted?.[0];
      return Response.json(
        {
          vehicle: v && {
            id: v.id,
            watchlistId: v.watchlist_id,
            registration: v.registration,
            label: v.label,
            operator: v.operator,
            vehicleRef: v.vehicle_ref,
            source: v.source,
            brand: v.brand,
          },
          storage: "supabase",
        },
        { status: 201 },
      );
    }

    const name = String(body.name || "Imported fleet").trim().slice(0, 80) || "Imported fleet";
    const vehicles = (body.vehicles || [])
      .map((item: Record<string, unknown>) => ({
        registration: normalise(String(item.registration || "")),
        label: String(item.label || ""),
        operator: String(item.operator || ""),
        vehicleRef: String(item.vehicleRef || ""),
        source: String(item.source || "auto"),
        brand: cleanBrand(item.brand),
      }))
      .filter((item: { registration: string }) => item.registration)
      .slice(0, 500);
    if (!vehicles.length) return Response.json({ error: "Add at least one registration" }, { status: 400 });

    if (body.replace) {
      await sb.rest.del("watched_vehicles", { id: "gte.0" });
      await sb.rest.del("watchlists", { id: "gte.0" });
    }

    const created = (await sb.rest.post("watchlists", { name })) as Array<{
      id: number;
      name: string;
      created_at: string;
    }>;
    const watchlist = created?.[0];
    if (!watchlist) return Response.json({ error: "Could not create watchlist" }, { status: 500 });
    if (vehicles.length) {
      await sb.rest.post(
        "watched_vehicles",
        vehicles.map((item: {
          registration: string;
          label: string;
          operator: string;
          vehicleRef: string;
          source: string;
          brand: string;
        }) => ({
          watchlist_id: watchlist.id,
          registration: item.registration,
          label: item.label,
          operator: item.operator,
          vehicle_ref: item.vehicleRef,
          source: item.source,
          brand: item.brand,
        })),
        "return=minimal",
      );
    }
    return Response.json(
      {
        watchlist: { id: watchlist.id, name: watchlist.name, createdAt: watchlist.created_at },
        vehicles,
        storage: "supabase",
      },
      { status: 201 },
    );
  } catch (err) {
    return Response.json({ error: String(err instanceof Error ? err.message : err) }, { status: 502 });
  }
}

export async function DELETE(request: Request) {
  if (!sb.configured()) {
    return Response.json(
      { deleted: false, storage: "unavailable", error: "Supabase is not configured" },
      { status: 503 },
    );
  }
  try {
    const q = new URL(request.url).searchParams;
    if (q.get("all") === "true") {
      await sb.rest.del("watched_vehicles", { id: "gte.0" });
      await sb.rest.del("watchlists", { id: "gte.0" });
      return Response.json({ deleted: true, cleared: true, storage: "supabase" });
    }
    const vehicleId = Number(q.get("vehicleId"));
    if (Number.isInteger(vehicleId) && vehicleId > 0) {
      await sb.rest.del("watched_vehicles", { id: `eq.${vehicleId}` });
      return Response.json({ deleted: true, vehicleId, storage: "supabase" });
    }
    const id = Number(q.get("id"));
    if (!Number.isInteger(id) || id < 1) {
      return Response.json({ error: "A valid watchlist id is required" }, { status: 400 });
    }
    await sb.rest.del("watched_vehicles", { watchlist_id: `eq.${id}` });
    await sb.rest.del("watchlists", { id: `eq.${id}` });
    return Response.json({ deleted: true, id, storage: "supabase" });
  } catch (err) {
    return Response.json({ error: String(err instanceof Error ? err.message : err) }, { status: 502 });
  }
}
