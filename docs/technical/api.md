# Worker API & webhooks

All endpoints accept `POST` with a JSON body and are restricted by CORS to `ALLOWED_ORIGINS`.
Errors: `{ "error": { "code", "message", "details"? } }`.

| Endpoint | Body | Response |
|---|---|---|
| `GET /health` | – | `{ ok, version }` |
| `/api/session` | `{ mainToken }` | `SessionView` |
| `/api/checkin` | `{ mainToken, fix: {lat,lng,accuracy,timestamp}, purpose: "general"\|"hunt" }` | `{ record, view }`; 403 `manual_disabled` when the lock uses live tracking only |
| `/api/privacy` | `{ mainToken, coordinates: "zone_only" }` | `SessionView` |
| `/api/config/get` | `{ configToken }` | `{ config, role, sessionId }` |
| `/api/config/save` | `{ configToken, config }` | `{ ok, config }`, 400 with zod issues, 403 on privacy upgrade during a session |
| `/api/capabilities` | `{ mainToken }` or `{ configToken }` | `{ commands[], live }` |
| `/api/tracking/pair` | `{ mainToken }` (wearer) | `{ link, url, username, password, view }` – OwnTracks provisioning link |
| `/api/tracking/unpair` | `{ mainToken }` (wearer) | `SessionView` |
| `/track/owntracks` | OwnTracks HTTP mode message, HTTP Basic auth with device credentials | `[]` or `[{_type:"cmd",action:"setWaypoints",…}]` |
| `/webhook` | Chaster webhook, HTTP Basic auth | `204` |

The browser never sends a `sessionId`; it is always resolved from the token via
`GET /api/extensions/auth/sessions/{mainToken}` or `GET /api/extensions/configurations/{token}`.

## Chaster API calls used

| Purpose | Chaster endpoint |
|---|---|
| Resolve main page token | `GET /api/extensions/auth/sessions/{mainToken}` |
| Read / save configuration | `GET`/`PUT /api/extensions/configurations/{token}` |
| Persist engine state | `PUT /api/extensions/sessions/{id}/data` |
| Lock page action & unlock blockers | `PUT /api/extensions/sessions/{id}/metadata` |
| Add/remove time, freeze, unfreeze, pillory | `POST /api/extensions/sessions/{id}/action` |
| History entry | `POST /api/extensions/sessions/{id}/logs/custom` |
| Task | `POST /api/extensions/sessions/{id}/tasks/assign` (actor `extension`) |
| Verification picture | `POST /api/extensions/sessions/{id}/verification-picture/request` |
| Other extension command | `POST /api/extensions/sessions/{id}/actions/{commandId}` (experimental) |
| Discover commands | `GET /api/extensions/sessions/{id}/capabilities` |
| Cron | `POST /api/extensions/sessions/search` |

## Webhooks handled

| Event | Action |
|---|---|
| `extension_session.created` | Initialise engine state and lock page metadata |
| `extension_session.updated` | Re-evaluate deadlines (e.g. after a configuration change) |
| `extension_session.deleted` | Purge the check-in history and the OwnTracks device credentials from KV |

## OwnTracks (background tracking, F14)

- Device credentials: KV `DEVICE:<username>` → `{ sessionId, hash: sha256(password) }`, plus `SESSIONDEV:<sessionId>`.
- Accepted messages: `_type: "location"` and `_type: "transition"`; everything else is ignored. The response pushes the lock's zones
  as waypoints whenever they changed (hunt checkpoints are never sent). The provisioning config enables `cmd` so the app accepts it.
- Each message costs ~3–5 Chaster API calls (session read, data and metadata write, plus consequences), well within the free tier at OwnTracks' rate.
- OwnTracks queues messages while offline; queued positions are evaluated at their own time (up to `tracking.maxDelayMinutes`).

## Cron

Every 5 minutes the worker walks all locked sessions (in batches; a cursor in KV keeps
it within the free tier's 50 sub-requests per invocation) and applies missed check-ins, ends timed freezes
and hunt time limits. A missed deadline is advanced in the session state together with the penalty,
so the same deadline is never penalised twice. Commands sent to other extensions additionally carry an
idempotency key derived from the deadline. (Edge case: if Chaster accepts the penalty but saving the
state fails, the next run may repeat it.)
