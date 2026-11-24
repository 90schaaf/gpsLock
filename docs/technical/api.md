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
| `/api/notify/setup` | `{ mainToken }` (wearer or keyholder) | `{ topic, url, deepLink, view }`; 503 `notifications_unavailable` without `NTFY_TOKEN` |
| `/api/notify/stop` | `{ mainToken }` | `SessionView` |
| `/api/notify/test` | `{ mainToken }` | `{ ok: true }` – test message to the own channel; 409 if not subscribed |
| `/api/hunt` | `{ mainToken, action: "start" \| "pause" \| "resume" \| "abort" }` | `SessionView`; 403 `hunt_action_not_allowed` |
| `/api/notice/ack` | `{ mainToken }` (wearer) | `SessionView` – clears the "rules changed" notice |
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
| `extension_session.deleted` | Purge history, OwnTracks device credentials, ntfy topics and due entries from D1 |

## OwnTracks (background tracking, F14)

- Device credentials: D1 table `devices (username, session_id, hash = sha256(password))`.
- Pairing provisions the effective monitoring mode (`owntracksMonitoring`: 2 = move, 1 = significant); when it changes, the next
  response contains `{_type:"cmd", action:"setConfiguration", configuration:{monitoring}}`.
- Waypoints = zones plus the hunt checkpoints visible to the wearer (reveal *all*/*map*), named `Hunt <n>: <name>`; a transition
  into such a waypoint completes the checkpoint.
- Accepted messages: `_type: "location"` and `_type: "transition"`; everything else is ignored. The response pushes the lock's zones
  as waypoints whenever they changed (hunt checkpoints are never sent). The provisioning config enables `cmd` so the app accepts it.
- Each message costs ~3–5 Chaster API calls (session read, data and metadata write, plus consequences), well within the free tier at OwnTracks' rate.
- OwnTracks queues messages while offline; queued positions are evaluated at their own time (up to `tracking.maxDelayMinutes`).

## Storage (D1)

| Table | Content |
|---|---|
| `history` | Check-ins and notable background updates, last 200 per session (JSON) |
| `devices` | OwnTracks credentials (password hash only) |
| `topics` | ntfy topic per session and audience (wearer / keyholder) |
| `due` | Next time a session needs a tick (`nextDueAt` of the engine) |
| `sent` | Sent notification keys (dedupe) and keyholder rate-limit markers (5 min) |
| `kv` | Cron cursor |

Engine state stays in the Chaster session data (`data.lockation`). Schema: `apps/worker/migrations/`.

## Cron

Every minute the worker ticks the sessions whose `due` time has come (forbidden-zone warnings and penalties, required
deadlines and warnings, missing signal, timed unfreeze, hunt timeout, random verification pictures). Every 5th minute it walks
all locked sessions in batches (cursor in D1) to stay within the free tier's 50 sub-requests per invocation. A missed deadline
or a penalty is advanced in the session state together with the consequence and carries a stable idempotency key, so it is
never applied twice. (Edge case: if Chaster accepts the penalty but saving the state fails, the next run may repeat it.)

## Notifications (ntfy)

The engine returns `notices` with every evaluation. Wearer notices (warnings) are sent to the wearer topic; keyholder notices
are filtered by `config.notifications.keyholder`, deduplicated, rate limited per kind and zone (5 min) and combined into one
message. Publishing uses ntfy's JSON API with `Authorization: Bearer NTFY_TOKEN`. Texts never contain coordinates.

## Configuration changes during a lock

`/api/config/save` with a running session computes `diffConfig(old, new)`; if anything changed it writes a "Lockation rules
changed" history entry, notifies the wearer and stores `state.rulesChanged` until `/api/notice/ack`.
