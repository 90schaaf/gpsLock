# 02 – Architecture (current state)

## 1. Overview

```
 ┌──────────────── Chaster app (web / iOS / Android) ────────────────┐
 │  iframe: main page   #{"mainToken":…}                              │
 │  iframe: config page #{"partnerConfigurationToken":…}              │
 └───────┬──────────────────────────────────────────────▲─────────────┘
         │ HTTPS                                         │ postMessage (config page),
 ┌───────▼───────────────────────────────┐               │ iframe-resizer (height)
 │ GitHub Pages                          │───────────────┘
 │  /        docs (VitePress)            │
 │  /app/    main page + config page     │   fetch, CORS: Pages origin only
 │           (Vite + Preact + Leaflet)   │──────────────────────────┐
 └───────────────────────────────────────┘                          │
                                                                    ▼
 ┌───────────────┐  HTTP mode, Basic auth   ┌──────────────────────────────────────┐
 │ OwnTracks app │─────────────────────────▶│ Cloudflare Worker (apps/worker)      │
 │ (wearer phone)│◀── setWaypoints /        │  /api/*        page API              │
 └───────────────┘    setConfiguration      │  /track/owntracks  background loc.   │
                                            │  /webhook      Chaster webhooks      │
 ┌───────────────┐  POST (Bearer NTFY_TOKEN)│  /health                             │
 │ ntfy.sh       │◀─────────────────────────│  cron * * * * *                      │
 │ → ntfy app    │                          │  D1: history devices topics due      │
 └───────────────┘                          │      sent kv                         │
                                            └──────────────┬───────────────────────┘
                                                           │ Bearer CHASTER_TOKEN
                                                           ▼
                                            https://api.chaster.app/api/extensions/…
```

## 2. Layers

| Layer | Content |
|---|---|
| `packages/core` – domain | Pure, deterministic functions: geo math, config / state schemas (zod), rule engine (`evaluateCheckin`, `evaluateTracked`, `evaluateTick`, `applyHuntAction`), anti-cheat, time windows and quiet hours, OwnTracks message parsing and provisioning, view model, metadata, config diff |
| `packages/core` – application service | One shared service used by the worker **and** the demo backend: resolve session → load state → evaluate → apply consequences → persist → notify → build view. It talks to the outside only through **ports**: Chaster calls (session auth, actions, logs, data, metadata, tasks, pictures, commands), storage (history, devices, topics, due index, sent markers, settings) and notifications |
| `apps/worker` – adapters | HTTP routing and validation, CORS, Basic auth, cron; port implementations: `ChasterClient`, D1 `Store`, ntfy client |
| `apps/web` | Main page and config page (Preact, Leaflet / OSM, Nominatim, Overpass for F17); `?demo` uses an in-browser backend that implements the same ports (fake Chaster, localStorage) |

Most tests live in `packages/core`, where they are cheap and fast; worker tests use a fake Chaster API and in-memory D1.

## 3. Repository layout

```
packages/core/        domain logic + application service (TypeScript, zod, vitest)
apps/worker/          Cloudflare Worker (wrangler, D1 migrations, vitest)
apps/web/             main + config page (Vite, Preact, Leaflet, vitest + jsdom)
docs/                 VitePress: user guide + technical docs
specifications/       this spec set (see README.md)
.github/workflows/    ci.yml, pages.yml, worker.yml
```

npm workspaces, TypeScript strict, ESM everywhere.

## 4. State ownership

| Data | Where | Why |
|------|-------|-----|
| Lock configuration (`LockationConfig` v2) | Chaster extension `config` | Chaster owns it and shows it to the wearer before accepting a shared lock |
| Engine state (`LockationState`) | Chaster session data `data.lockation` | Authoritative per session; deleted with the session |
| Check-in history (last 200) | D1 `history` | Too large for session data |
| OwnTracks devices | D1 `devices` (password SHA-256 only) | Lookup by username on every OwnTracks request |
| ntfy topics (wearer / keyholder) | D1 `topics` | Secret per session and audience |
| Next due time per session | D1 `due` | The 1-minute cron touches only due sessions |
| Sent notifications / rate-limit markers | D1 `sent` | Dedupe, pruned after 7 days |
| Cron cursor | D1 `kv` (`cron:cursor`) | Full sweep in batches across invocations |

Everything stored in D1 for a session is purged on `extension_session.deleted`.

## 5. Evaluation flows

**Manual check-in.** Page: `getCurrentPosition({enableHighAccuracy: true, maximumAge: 0, timeout: 20000})` →
`POST /api/checkin {mainToken, fix, purpose}` → resolve session (role `wearer`, lock `locked`) → `evaluateCheckin(config,
state, fix, ctx)` returns `{state, consequences, events, notices, record}` → apply consequences sequentially
(best effort, failures recorded) → one custom log entry, save `data.lockation`, update metadata, append history, update the
due index, send notifications → wearer-safe view (no hidden checkpoints, no hidden timer data).

**Background location.** `POST /track/owntracks` (Basic auth with device credentials) → device lookup → parse message →
`evaluateTracked` at observation time → same apply / persist path → response with `setWaypoints` / `setConfiguration`
commands when needed.

**Cron (`* * * * *`).**
- Every minute: sessions from `due` whose `next_at` has come (forbidden warnings / penalties, deadlines, warnings, timed
  unfreeze, scheduled hunt start, live verification) → `evaluateTick`.
- Every 5th minute: full sweep over all locked sessions via Chaster session search, batched with a cursor in `kv`
  (subrequest budget per invocation); prunes `sent` at the end of a sweep.

**Webhooks.** `extension_session.created` → initial state; `.updated` → tick; `.deleted` → purge D1 data.

**Config save.** `POST /api/config/save` → validate (schema, disclaimer) → `PUT` configuration; with a running session,
diff old / new and announce the change (log, ntfy, `rulesChanged`).

## 6. Security

- `CHASTER_TOKEN`, `WEBHOOK_USERNAME`, `WEBHOOK_PASSWORD` and `NTFY_TOKEN` are Worker **secrets**; the Chaster token
  exists only in the worker. The frontend sends only `mainToken` / `partnerConfigurationToken`; the session id is always
  resolved on the server.
- Roles: only `wearer` and `keyholder` are accepted (`403 not_allowed`); only the wearer checks in, acknowledges notices
  and pairs devices; coordinates go to the keyholder only with exact sharing; anyone can downgrade privacy, nobody can
  upgrade it during a session.
- CORS: only `ALLOWED_ORIGINS` (GitHub Pages origin, localhost in dev).
- Basic auth: webhooks with the webhook credentials (constant-time comparison); OwnTracks with per-device credentials,
  stored as SHA-256 password hashes.
- Idempotency: deadlines and escalation steps advance in the persisted state, so each is penalised once; broker commands
  carry `idempotencyKey = <sessionId>:<evaluation | stable key>:<index>`. Plain lock actions have no idempotency key in the
  Chaster API.
- Config page accepts `postMessage` only from `window.parent` (and `VITE_CHASTER_ORIGINS` if set).
- zod validation of every request body and of the configuration.
- Notifications never contain coordinates.

## 7. Deployment

- **GitHub Pages** (`pages.yml`): docs at `/`, app at `/app/`, one artifact; base path from `PAGES_BASE`.
- **Cloudflare** (`worker.yml`): `wrangler deploy` on push to `main` when `CLOUDFLARE_API_TOKEN` is set. D1 database
  `lockation` (binding `DB`), schema via `wrangler d1 migrations apply lockation --remote`. Vars: `CHASTER_API_BASE`,
  `ALLOWED_ORIGINS`, `EXTENSION_SLUG`, `APP_URL`, optional `PUBLIC_URL`, `NTFY_BASE`. `/health` returns
  `{ok, version, commit}`.
- **Chaster developer portal**: main / config iframe URLs, webhook URL and credentials, `browserCapabilities:
  ["geolocation"]`, modes, testers – step by step in `docs/technical/setup.md`.
