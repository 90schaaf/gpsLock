# Technical overview

GPS Lock consists of three deployable parts:

| Part | Tech | Hosted on | Purpose |
|------|------|-----------|---------|
| `apps/web` | Vite, Preact, Leaflet | **GitHub Pages** (`/app/`) | Main page and configuration page embedded by Chaster |
| `apps/worker` | Cloudflare Worker, KV, cron | **Cloudflare Workers** (free tier) | Keeps the Chaster developer token secret, runs the rules, receives webhooks, enforces deadlines |
| `docs` | VitePress | **GitHub Pages** (`/`) | This documentation |

All rule logic lives in `packages/core` (pure TypeScript, unit tested). The worker and the demo mode in the browser share it.

```
Chaster app ──iframe──▶ GitHub Pages (apps/web) ──fetch──▶ Cloudflare Worker ──Bearer token──▶ api.chaster.app
                                                              ▲   │ cron */5
Chaster webhooks ─────────────── Basic auth ──────────────────┘   └─ KV (check-in history)
```

## Why a Worker?

Every Chaster Extensions API call needs the secret **developer token**. A GitHub Pages site is
public, so it cannot hold the token. The Worker is the smallest secure backend: it exchanges the
`mainToken` / `partnerConfigurationToken` passed by Chaster for session data and runs all actions.

## Where state lives

- Lock configuration → Chaster extension config (Chaster shows it to the wearer).
- Engine state (deadlines, hunt progress, …) → Chaster session `data.gpsLock`.
- Check-in history (last 200) → Workers KV, purged when the session is deleted.

The full specification is in the repository under `specifications/`.

Next: [Setup & wiring](./setup).
