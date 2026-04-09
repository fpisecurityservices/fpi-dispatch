# FPI Dispatch Dashboard

A production dispatch operations dashboard for FPI Security Services.

## Stack
- **Frontend**: Vanilla HTML/CSS/JS in `public/`
- **Backend**: Vercel Serverless Functions in `api/`
- **Database**: Vercel Postgres (Neon) — 30-day entry retention
- **Alerts**: n8n webhook → email (server-side, no keys exposed to browser)

---

## Deployment (one time setup)

### 1. Push to GitHub
Create a new **private** GitHub repo and push this entire folder to it.

### 2. Create Vercel Project
1. Go to [vercel.com](https://vercel.com) → New Project
2. Import the GitHub repo you just created
3. Framework Preset: **Other**
4. Root Directory: leave as `/`
5. Click **Deploy** (it will fail on first deploy — that's OK, you need the DB first)

### 3. Provision Postgres
1. In your Vercel project → **Storage** tab → **Create Database**
2. Select **Postgres** (powered by Neon)
3. Choose a region close to Florida (US East)
4. Click Create — Vercel automatically adds `POSTGRES_URL` to your environment

### 4. Add Environment Variables
In Vercel project → **Settings** → **Environment Variables**, add:

| Key | Value |
|-----|-------|
| `N8N_WEBHOOK_URL` | Your n8n webhook URL |
| `ALERT_RECIPIENTS` | Fallback email(s), comma-separated |

### 5. Redeploy
In Vercel → **Deployments** → click the three dots on the latest → **Redeploy**

### 6. Initialize the Database
Visit this URL once after deployment:
```
https://your-project.vercel.app/api/init
```
You should see: `{"ok":true,"message":"Database initialized successfully."}`

### 7. Configure the App
1. Open the app URL
2. Add yourself as a dispatcher
3. Click **Settings** → enter your n8n webhook URL and recipient emails
4. Click **Send Test Alert** to confirm email delivery

---

## n8n Webhook Setup

1. Create a new workflow
2. Add **Webhook** trigger node → Method: POST → note the URL
3. Add **Send Email** node (Gmail or Microsoft 365). Use these expressions:

**Subject:**
```
[FPI DISPATCH] {{ $json.alertType }} — {{ $json.category }}
```

**Body:**
```
Alert:      {{ $json.alertType }}
Time:       {{ $json.timestamp }}
Dispatcher: {{ $json.dispatcher }}
Caller:     {{ $json.callerType }}
Guard/Name: {{ $json.guardName }}
Unit:       {{ $json.unitId }}
Location:   {{ $json.location }}
Category:   {{ $json.category }}
Priority:   {{ $json.priority }}
Notes:      {{ $json.notes }}
```

**To:** `{{ $json.recipients }}`

4. On the Webhook node → **Options** → set `Access-Control-Allow-Origin: *`
5. Activate the workflow

---

## API Reference

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/init` | GET | Create DB tables (run once) |
| `/api/entries` | GET | Fetch entries (`?days=30`) |
| `/api/entries` | POST | Create new entry |
| `/api/entries/[id]` | PATCH | Update status / promote to incident |
| `/api/dispatchers` | GET | List active dispatchers |
| `/api/dispatchers` | POST | Add dispatcher |
| `/api/dispatchers` | DELETE | Deactivate dispatcher |
| `/api/shifts` | POST | Log shift start / handoff |
| `/api/settings` | GET | Get app settings |
| `/api/settings` | POST | Update app settings |

---

## Database Schema

```sql
dispatchers   — id, name, active, created_at
entries       — id, ts, caller_type, guard_name, unit_id, location,
                category, priority, notes, status, is_incident,
                is_ncns, dispatcher_name
shift_log     — id, ts, dispatcher_name, action, note
app_settings  — key, value
```

---

## Local Development

```bash
npm install -g vercel
vercel dev        # runs at localhost:3000
```

You'll need a `.env.local` file with your `POSTGRES_URL` from Vercel.
