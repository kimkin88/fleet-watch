-- Fleet Watch — Supabase schema for campaign audit (+ optional watchlists)
-- Run this in the Supabase SQL editor (Dashboard → SQL → New query).
-- Then set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY on Vercel / local .env

create extension if not exists pgcrypto;

-- ---------- Campaign audit ----------

create table if not exists audit_campaigns (
  id text primary key,
  name text not null,
  start_date date not null,
  end_date date not null,
  registrations text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists audit_activity (
  registration text not null,
  day date not null,
  dm integer not null default 0,
  ds integer not null default 0,
  nm integer not null default 0,
  ns integer not null default 0,
  km double precision not null default 0,
  primary key (registration, day)
);

create table if not exists audit_vehicles (
  registration text primary key,
  euro text not null default 'VI',
  euro_source text not null default 'assumed',
  fuel text not null default 'DIESEL',
  year integer,
  make text not null default '',
  note text,
  checked_at timestamptz
);

create table if not exists audit_weather (
  day date primary key,
  n integer not null default 0,
  wet integer not null default 0,
  day_n integer not null default 0,
  day_wet integer not null default 0,
  temp_sum double precision not null default 0
);

create table if not exists audit_last_pos (
  registration text primary key,
  lat double precision not null,
  lng double precision not null,
  updated_at timestamptz not null default now()
);

create table if not exists audit_sampler (
  id integer primary key default 1 check (id = 1),
  running boolean not null default true,
  last_sample_at timestamptz,
  last_error text,
  tracked integer not null default 0,
  seen_bods integer not null default 0,
  seen_tfl integer not null default 0,
  interval_minutes numeric not null default 1,
  started_at timestamptz,
  last_weather jsonb,
  last_weather_at timestamptz,
  host text not null default 'supabase'
);

insert into audit_sampler (id, running, started_at, host)
values (1, true, now(), 'supabase')
on conflict (id) do nothing;

-- Atomic minute bumps (used by the serverless sampler)
create or replace function audit_bump_activity(
  p_registration text,
  p_day date,
  p_dm integer default 0,
  p_ds integer default 0,
  p_nm integer default 0,
  p_ns integer default 0,
  p_km double precision default 0
) returns void
language plpgsql
as $$
begin
  insert into audit_activity as a (registration, day, dm, ds, nm, ns, km)
  values (p_registration, p_day, p_dm, p_ds, p_nm, p_ns, p_km)
  on conflict (registration, day) do update set
    dm = a.dm + excluded.dm,
    ds = a.ds + excluded.ds,
    nm = a.nm + excluded.nm,
    ns = a.ns + excluded.ns,
    km = a.km + excluded.km;
end;
$$;

create or replace function audit_bump_weather(
  p_day date,
  p_wet boolean,
  p_daytime boolean,
  p_temp double precision
) returns void
language plpgsql
as $$
begin
  insert into audit_weather as w (day, n, wet, day_n, day_wet, temp_sum)
  values (
    p_day,
    1,
    case when p_wet then 1 else 0 end,
    case when p_daytime then 1 else 0 end,
    case when p_wet and p_daytime then 1 else 0 end,
    coalesce(p_temp, 0)
  )
  on conflict (day) do update set
    n = w.n + 1,
    wet = w.wet + case when p_wet then 1 else 0 end,
    day_n = w.day_n + case when p_daytime then 1 else 0 end,
    day_wet = w.day_wet + case when p_wet and p_daytime then 1 else 0 end,
    temp_sum = w.temp_sum + coalesce(p_temp, 0);
end;
$$;

-- ---------- Optional fleet watchlists (dashboard persistence) ----------

create table if not exists watchlists (
  id bigint generated always as identity primary key,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists watched_vehicles (
  id bigint generated always as identity primary key,
  watchlist_id bigint not null references watchlists(id) on delete cascade,
  registration text not null,
  label text not null default '',
  operator text not null default '',
  vehicle_ref text not null default '',
  source text not null default 'auto',
  brand text not null default '',
  created_at timestamptz not null default now(),
  unique (watchlist_id, registration)
);

create index if not exists watched_vehicles_watchlist_idx on watched_vehicles (watchlist_id);

-- Service-role key bypasses RLS. Lock down anon/authenticated completely.
alter table audit_campaigns enable row level security;
alter table audit_activity enable row level security;
alter table audit_vehicles enable row level security;
alter table audit_weather enable row level security;
alter table audit_last_pos enable row level security;
alter table audit_sampler enable row level security;
alter table watchlists enable row level security;
alter table watched_vehicles enable row level security;

-- No policies for anon/authenticated → only service role can read/write.
