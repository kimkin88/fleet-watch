# Fleet Watch — agent instructions

## "push it"
When James says **"push it"** (or push / commit / ship it / send it to github) — run immediately:

```bash
bash "/Users/james/Desktop/landing page/fleet-watch-llm-bundle/push-to-github.sh"
```

Optional message: `bash "…/push-to-github.sh" "what changed"`.

## Stack
- **Next.js 15** App Router (`app/`), React 19, TypeScript
- Server libs in `lib/` (BODS, Supabase audit)
- Static assets in `public/`
- Supabase schema: `supabase/schema.sql`

## Commands
```bash
npm run dev      # localhost:3000
npm run build
npm start
```

## Key routes
`/`, `/dashboard`, `/network-insights`, `/api-proof`, `/campaign-audit`, plus `/api/bods`, `/api/audit/*`, `/api/watchlist`.

Env: see `.env.example`. Never commit secrets.
