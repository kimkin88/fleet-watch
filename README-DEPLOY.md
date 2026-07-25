# Fleet Watch — deploy (Next.js on Vercel)

## Vercel (primary)

1. Create a Supabase project → run `supabase/schema.sql` in the SQL editor.
2. Import this repo on Vercel (framework: **Next.js**).
3. Environment variables (all environments):
   - `BODS_API_KEY`
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY` (service_role — server only)
   - `CRON_SECRET` (Bearer token for `/api/audit/sample`)
   - Optional: `TFL_API_KEY`, `DVLA_API_KEY`
4. Deploy.

Verify:
- `https://<url>/api/bods/health` → `"connected": true`
- `https://<url>/api/audit` → `"storage": "supabase"` when configured
- Pages: `/`, `/dashboard`, `/network-insights`, `/api-proof`, `/campaign-audit`

**Cron:** `vercel.json` schedules `/api/audit/sample` once daily (`0 0 * * *`, Hobby-safe). Use **Renew now** on `/campaign-audit` (or `POST /api/audit/sample`) for an immediate sample. Minute cadence needs Pro or an external cron with `Authorization: Bearer <CRON_SECRET>`.

## Local

```bash
npm install
npm run dev
```

## Render (optional Node host)

Prefer Vercel for this Next.js app. If you need a long-running process elsewhere, use Vercel Cron + Supabase instead of a classic `node server.js` host.
