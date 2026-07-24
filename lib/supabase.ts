/** Supabase REST + RPC client (PostgREST). Server-only. */

export function configured() {
  return !!(process.env.SUPABASE_URL || "").trim() && !!(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
}

function baseUrl() {
  return String(process.env.SUPABASE_URL || "").trim().replace(/\/$/, "");
}

function headers(extra?: Record<string, string>) {
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  return {
    apikey: key,
    authorization: `Bearer ${key}`,
    "content-type": "application/json",
    ...(extra || {}),
  };
}

type RequestOpts = {
  query?: Record<string, string | undefined | null>;
  body?: unknown;
  prefer?: string;
};

async function request(method: string, path: string, { query, body, prefer }: RequestOpts = {}) {
  if (!configured()) throw new Error("Supabase is not configured (set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)");
  const url = new URL(baseUrl() + path);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      url.searchParams.set(k, String(v));
    }
  }
  const res = await fetch(url, {
    method,
    headers: headers(prefer ? { prefer } : undefined),
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    const obj = data as { message?: string; error?: string } | null;
    const msg = obj?.message || obj?.error || text || res.statusText;
    const err = new Error(`Supabase ${method} ${path} → HTTP ${res.status}: ${msg}`) as Error & {
      status?: number;
      data?: unknown;
    };
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const rest = {
  get: (table: string, query?: RequestOpts["query"]) => request("GET", `/rest/v1/${table}`, { query }),
  post: (table: string, body: unknown, prefer = "return=representation") =>
    request("POST", `/rest/v1/${table}`, { body, prefer }),
  patch: (
    table: string,
    query: RequestOpts["query"],
    body: unknown,
    prefer = "return=representation",
  ) => request("PATCH", `/rest/v1/${table}`, { query, body, prefer }),
  del: (table: string, query: RequestOpts["query"]) =>
    request("DELETE", `/rest/v1/${table}`, { query, prefer: "return=minimal" }),
  upsert: (table: string, body: unknown, onConflict?: string) =>
    request("POST", `/rest/v1/${table}`, {
      body,
      prefer: "resolution=merge-duplicates,return=representation",
      query: onConflict ? { on_conflict: onConflict } : undefined,
    }),
};

export async function rpc(fn: string, args?: Record<string, unknown>) {
  return request("POST", `/rest/v1/rpc/${fn}`, { body: args || {} });
}
