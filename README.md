# FPI Dispatch Operations Portal v2

Vercel + Postgres. No framework. Vanilla JS frontend, Node.js serverless API.

## Setup (one time)

1. Push this repo to GitHub
2. Import into your existing Vercel project (Settings → Git → change repository)
   OR create a new Vercel project and connect your Postgres storage
3. Make sure these env vars are set in Vercel (copy from your Storage tab):
   - `POSTGRES_URL`, `POSTGRES_URL_NON_POOLING`, `POSTGRES_USER`,
     `POSTGRES_HOST`, `POSTGRES_PASSWORD`, `POSTGRES_DATABASE`
   - `N8N_WEBHOOK_URL` — your n8n webhook URL
4. Run the migrations once (Vercel dashboard → Storage → Query), in order:
   paste and run each of `migrations/001_init_v2_schema.sql`,
   `002_add_accounts.sql`, `003_add_app_config.sql`,
   `004_add_escalation_protocols.sql`, and `005_add_bols.sql`
5. Update dispatcher names, contacts, and routing rules in the seeded data
   inside the migration SQL before running, OR edit them in the portal's
   Settings modal after first deploy

## Deploying

Push to `main` — Vercel deploys automatically.

For staging: push to any branch and Vercel creates a preview URL.

## Structure

```
/api/           serverless functions (Node 18, ES modules)
/lib/           shared helpers (enums + DB row transforms)
/migrations/    SQL schema — run manually once
/public/        static frontend (index.html + dispatch.js)
```

## Updating contacts / dispatchers / rules

Use the Settings modal in the portal. All changes persist to Postgres immediately.
Dispatcher names in `migrations/001_init_v2_schema.sql` are only seed data.
