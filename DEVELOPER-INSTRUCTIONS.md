# Fleet Watch — developer handoff (Next.js)

Next.js 15 App Router app: live bus-advert tracking (TfL + BODS) and Supabase-backed campaign audit.

## Structure

| Path | Purpose |
|------|---------|
| `app/page.tsx` | Marketing landing `/` |
| `app/dashboard/` | Live map dashboard |
| `app/network-insights/` | TfL insights |
| `app/api-proof/` | API proof / inventory |
| `app/campaign-audit/` | Proof-of-play audit UI |
| `app/api/bods/` | BODS SIRI-VM relay |
| `app/api/audit/` | Audit summary, campaigns, sample cron |
| `app/api/watchlist/` | Optional fleet persistence |
| `lib/siri.ts` | BODS fetch/parse |
| `lib/supabase.ts` | PostgREST client |
| `lib/audit-sb.ts` | Audit engine (Supabase) |
| `components/legacy/` | Page UI ported from the previous static HTML |
| `supabase/schema.sql` | Postgres schema |
| `public/` | Fonts, logos, sample CSV |

## Env

See `.env.example`. Required for production: `BODS_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`.

## Commands

```bash
npm install
npm run dev      # http://localhost:3000
npm run build
npm start
```

## Notes

- Old `*.html` paths redirect to App Router routes (`next.config.ts`).
- BODS has no CORS — always call it via `/api/bods`.
- Audit minutes accumulate only while `/api/audit/sample` runs (cron).
