# Fleet Watch

Live campaign bus tracking for outdoor advertising — **Next.js App Router** + TfL + BODS + Supabase audit.

## Routes

| Path | Page |
|------|------|
| `/` | Marketing landing |
| `/dashboard` | Live campaign map |
| `/network-insights` | TfL network dashboards |
| `/api-proof` | Endpoint health / inventory |
| `/campaign-audit` | Proof-of-play audit |

Legacy `*.html` URLs redirect to these paths.

## API

- `GET /api/bods?registrations=`
- `GET /api/bods/health`
- `GET /api/audit`
- `POST|DELETE /api/audit/campaigns`
- `GET|POST /api/audit/sample` (Vercel Cron)
- `GET|POST|DELETE /api/watchlist`

## Develop

```bash
cp .env.example .env.local   # BODS_API_KEY, Supabase keys, CRON_SECRET
npm install
npm run dev                  # http://localhost:3000
```

## Deploy (Vercel)

1. Run `supabase/schema.sql` in the Supabase SQL editor.
2. Import the repo on Vercel (Next.js detected automatically).
3. Set env: `BODS_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`.
4. Deploy. Minute cron needs Pro (or an external cron hitting `/api/audit/sample`).

```bash
npm run build && npm start
```
