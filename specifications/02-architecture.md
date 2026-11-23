# 02 – Architecture

## 1. Overview

```
 ┌──────────────── Chaster app (web / iOS / Android) ────────────────┐
 │  iframe: main page  #{"mainToken":…}                               │
 │  iframe: config page #{"partnerConfigurationToken":…}              │
 └───────┬───────────────────────────────────────────────▲────────────┘
         │ HTTPS (GitHub Pages)                          │ postMessage (config page)
 ┌───────▼──────────────────────────┐                    │
 │ apps/web  (static, Vite + Preact)│────────────────────┘
 │  /app/            main page      │
 │  /app/config.html config page    │      fetch (CORS: Pages origin only)
 │  Leaflet + OSM tiles             │──────────────────────────┐
 └──────────────────────────────────┘                          │
                                                               ▼
 ┌──────────────────────────────────────────────────────────────────────┐
 │ apps/worker  (Cloudflare Worker)                                     │
 │  POST /api/session        mainToken → view model                     │
 │  POST /api/checkin        mainToken + fix → evaluate + apply         │
 │  POST /api/privacy        wearer downgrades coordinate sharing       │
 │  POST /api/config/get     configToken → config                       │
 │  POST /api/config/save    configToken + config → validate + PUT      │
 │  POST /api/capabilities   configToken|mainToken → available commands │
 │  POST /webhook            Chaster webhooks (Basic auth)              │
 │  cron */5 * * * *         deadlines, timed unfreeze, hunt timeouts   │
 │  KV: HISTORY (check-in log), CRON cursor                             │
 └──────────┬───────────────────────────────────────────────────────────┘
            │ Bearer DEVELOPER_TOKEN
            ▼
     https://api.chaster.app/api/extensions/…
```

`packages/core` holds **all domain logic as pure, deterministic functions**: geo math,
config schema, rule engine, anti-cheat, scheduling, and the scavenger hunt. The worker
and the web app import it, and the web app's demo mode uses it too. This puts most
tests where they are cheap and fast.

## 2. Repository layout

```
packages/core/        domain logic (TypeScript, zod, vitest)
apps/worker/          Cloudflare Worker (TypeScript, wrangler, vitest)
apps/web/             main + config page (Vite, Preact, Leaflet, vitest + jsdom)
docs/                 VitePress site: technical setup guide + user guide
specifications/       this spec set
.github/workflows/    ci.yml, pages.yml, worker.yml
```

npm workspaces, TypeScript strict mode, ESM everywhere.

## 3. State ownership

| Data | Where | Why |
|------|-------|-----|
| Lock configuration (`LockationConfig`) | Chaster extension `config` | Chaster owns it and shows it to the wearer before they accept a shared lock |
| Engine state (`LockationState`) | Chaster session `data` | Authoritative and per session; no consistency issues with KV; deleted together with the session |
| Check-in history (last 200) | Workers KV `HISTORY:<sessionId>` | Too large for session data; purged on `extension_session.deleted` |
| Cron cursor | Workers KV `CRON:cursor` | Batching across invocations (subrequest limit) |

## 4. Security

- The developer token and webhook credentials are Worker **secrets** (`wrangler secret put`).
- The frontend only ever sends `mainToken` / `partnerConfigurationToken`; the
  `sessionId` is always resolved on the server.
- Role checks: only the **wearer** can check in; only the **keyholder** (or the wearer
  on a self-lock) can see coordinate history; anyone can downgrade privacy, nobody can upgrade it during a session.
- CORS allows only `ALLOWED_ORIGIN` (the GitHub Pages origin; plus localhost in dev).
- Webhooks: constant-time comparison of the Basic auth credentials.
- Idempotency: deadlines are advanced in the persisted session state, so a deadline is penalised once.
  Broker commands (other extensions) carry `idempotencyKey = <sessionId>:<evalId | missed:<deadline>>:<index>`.
  Plain lock actions (`/action`) have no idempotency key in the Chaster API.
- The config page accepts `postMessage` save requests only from `window.parent` (and, if
  `VITE_CHASTER_ORIGINS` is set, only from those origins).
- Input validation: zod schemas for every request body and for the configuration.

## 5. Check-in sequence

1. The wearer taps **Check in**. The page calls
   `navigator.geolocation.getCurrentPosition({enableHighAccuracy:true, maximumAge:0, timeout:20000})`.
2. `POST /api/checkin {mainToken, fix:{lat,lng,accuracy,timestamp,altitude?,speed?}}`.
3. The worker resolves the session (role must be `wearer`, lock must be `locked`).
4. `core.evaluateCheckin(config, state, fix, now)` returns
   `{ record, consequences[], nextState, messages[] }`. It is pure.
5. The worker applies the consequences sequentially through the `ChasterClient`
   (best effort; failures are reported in the record).
6. The worker writes a custom log entry, stores `nextState` in session data, updates
   metadata (home action and badge, unlock blockers), and appends the record to KV history.
7. The response contains a view model safe for the wearer (no hidden timer
   information, and no hunt target coordinates unless the reveal mode allows them).

## 6. Cron sequence (every 5 minutes)

For each locked session (batched, cursor in KV):
`core.evaluateTick(config, state, now)` → consequences (missed required check-in
after grace, end of timed freeze, hunt timeout) → apply → persist state/metadata.

## 7. Deployment

- **GitHub Pages** (`pages.yml`): builds the docs (VitePress) to `/` and the app to `/app/`
  in one artifact. Base path from the `PAGES_BASE` env var (default `/<repo>/`).
- **Cloudflare** (`worker.yml`): `wrangler deploy` on push to `main` when
  `CLOUDFLARE_API_TOKEN` is set; otherwise skipped.
- **Chaster developer portal**: `mainIframeUrl`, `configIframeUrl`, `webhookUrl`,
  webhook credentials, `browserCapabilities: ["geolocation"]`, mode `unlimited`,
  testers. Described step by step in `docs/technical/`.
