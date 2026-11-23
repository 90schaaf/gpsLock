# 03 – Feature Specification

Each feature has an ID, a behaviour description, and acceptance criteria (AC). The
ACs are covered by automated tests (`packages/core/test`, `apps/worker/test`,
`apps/web/test`). The test files reference the feature IDs in their `describe` blocks.

Terms: *fix* = one GPS reading from the browser. *Check-in* = a fix submitted by the
wearer. *Accepted check-in* = a check-in that passed anti-cheat.

---

## F1 – Zones and geofence matching

Zones are circles `{id, name, lat, lng, radiusM}` with `20 ≤ radiusM ≤ 50 000` (changed from 50 on 2026-11-23); the editor shows a hint for zones below 100 m.
A lock has at most **20 places in total** (zones + hunt checkpoints, `MAX_PLACES`), matching the iOS limit of 20 monitored regions per app. Validation error: "at most 20 zones and hunt checkpoints in total (currently N)"; the config editor shows "N / 20 places used" and blocks adding more.
The distance is the haversine distance in metres (Earth radius 6 371 008.8 m).

The per-lock setting `matchMode` controls when a fix counts as inside a zone:
- `lenient` (default): inside ⇔ `distance ≤ radius`
- `strict`: inside ⇔ `distance + accuracy ≤ radius` (certainly inside)

AC:
1. The haversine distance is within 0.5 % of reference values (Zürich→Bern ≈ 95.5 km; 0 for identical points).
2. In lenient mode, a fix exactly on the border is inside; in strict mode, a fix that is inside but whose accuracy circle crosses the border is outside.
3. The config rejects a zone radius below 50 m or above 50 km, and zone ids must be unique.

## F2 – Required check-in

Config: `{enabled, zoneIds[], intervalMinutes, graceMinutes, quietHours?{start:"HH:MM", end:"HH:MM"}, onSuccess[], onOutside[], onMissed[]}`.
An empty `zoneIds` means **anywhere**: the wearer only has to prove their position regularly, which makes forbidden zones enforceable.

- `deadline = (lastValidRequiredCheckinAt ?? sessionStartedAt) + interval`.
  If the deadline falls inside quiet hours (in the lock's `timezone`), it moves to the end of the quiet window.
- An accepted check-in inside one of the zones (or anywhere if the list is empty) is
  *valid*: it applies `onSuccess` and resets the clock.
- An accepted check-in outside all required zones applies `onOutside` and does **not** reset the clock.
- The cron applies `onMissed` once when `now ≥ deadline + grace`. The next deadline
  is then `previousDeadline + interval`, so every further missed interval is penalised again.

AC:
1. A valid check-in resets the deadline to `now + interval`.
2. An outside check-in applies `onOutside` and leaves the deadline unchanged.
3. The tick applies `onMissed` exactly once per missed interval, even when called repeatedly.
4. After 3 missed intervals (cron down for a while), the next tick applies `onMissed` 3 times. It is capped at 10 per tick.
5. A deadline inside quiet hours moves to the end of quiet hours, including windows that cross midnight.

## F3 – Forbidden zones

Config: `{enabled, zoneIds[], cooldownMinutes, onEnter[]}`.
An accepted check-in inside a forbidden zone applies `onEnter`, at most once per zone per cooldown.

AC: 1. Check-in inside → consequences applied. 2. A second check-in inside within the cooldown → none applied. 3. Outside → none.

## F4 – Reward zones

Config: `{enabled, zoneIds[], cooldownMinutes, maxPerDay, onEnter[]}`.
An accepted check-in inside a reward zone applies `onEnter`, limited by the per-zone
cooldown and `maxPerDay` (all reward zones together, counted per calendar day in the lock's timezone).

AC: 1. Reward applied. 2. Cooldown respected. 3. Daily cap respected and reset on the next day.

## F5 – Travel goals

Config: `{enabled, stepKm, maxKmPerCheckin, dailyCapKm, onStep[]}`.
The distance between consecutive accepted check-ins is added to `travel.pendingKm`
(capped by `maxKmPerCheckin` and `dailyCapKm`). For every full `stepKm`, `onStep` is
applied once. Time consequences are **scaled** by the number of steps; other
consequence types are applied once per check-in if at least one step was completed.

AC: 1. 2.5 km travelled with stepKm 1 → 2 steps, remainder 0.5 km carried over. 2. Caps respected. 3. An implausible-speed check-in adds no distance.

## F6 – Scavenger hunt

Config: `{enabled, checkpoints[{id,name,lat,lng,radiusM,hint}], reveal: "hint"|"distance"|"map", wrongCooldownMinutes, timeLimitMinutes?, blockUnlockUntilComplete, onCheckpoint[], onWrong[], onComplete[], onTimeout[]}`.

- The hunt starts with the session. Only the **current** checkpoint is relevant (ordered).
- A check-in inside the current checkpoint applies `onCheckpoint` and advances the hunt.
  After the last checkpoint, `onComplete` is applied and the hunt is completed.
- A check-in anywhere else is a *wrong turn*: it applies `onWrong`, at most once per `wrongCooldownMinutes`.
- Reveal to the wearer: `hint` = only the hint text; `distance` = hint plus a distance band
  (`< 200 m`, `< 500 m`, `< 1 km`, `< 5 km`, `> 5 km`) after each check-in; `map` = hint plus a pin on the map.
- Optional time limit: the cron applies `onTimeout` once and marks the hunt as failed.
- `blockUnlockUntilComplete` adds a `reasonsPreventingUnlocking` entry until the hunt is completed.

AC: 1. A correct order advances; the last checkpoint completes. 2. A wrong check-in applies `onWrong`, with cooldown. 3. Checkpoints after the current one are never sent to the wearer. 4. The timeout is applied once. 5. The unlock blocker is set while active and cleared on completion or failure.

## F7 – Consequences

`Consequence` (discriminated union, `type` field):

| type | params | Chaster call |
|------|--------|--------------|
| `add_time` / `remove_time` | `seconds` (1 … 31 536 000) | `POST /sessions/{id}/action` |
| `freeze` | `durationMinutes?` (timed → cron unfreezes) | action `freeze` |
| `unfreeze` | – | action `unfreeze` |
| `pillory` | `durationMinutes` (5–1440), `reason` | action `pillory` |
| `log` | `message` | custom log only |
| `task` | `task`, `points`, `verificationRequired`, `durationMinutes?` | `POST /sessions/{id}/tasks/assign` (actor `extension`) |
| `verification_picture` | – | `POST /sessions/{id}/verification-picture/request` |
| `command` | `commandId` (`<slug>.<name>`), `input` | `POST /sessions/{id}/actions/{commandId}` (experimental) |

- Every check-in or tick writes **one** custom log entry that summarises the outcome and the consequences.
- A failing consequence never aborts the others. The failure is recorded and shown to the keyholder.
- `command` consequences: the config page lists the lock's discovered capabilities
  (or the known public manifests before the lock exists) and lets the user enter the input as JSON.

AC: 1. Each type maps to the correct HTTP request (method, path, body). 2. An idempotency key is sent for broker commands. 3. One failure → the others still run, and the result lists the error.

## F8 – Anti-cheat

Config `antiCheat: {maxAccuracyM (10–500, default 100), maxFixAgeSeconds (default 120), maxSpeedKmh (default 200), onImplausible: "reject"|"reject_and_penalize"|"accept_and_verify", implausibleConsequences[], verificationPicture: "never"|"always"|"random", verificationProbability (0–1), minIntervalSeconds (default 60)}`.

Order: rate limit → stale/future timestamp → accuracy → speed → accept.
Speed: `effectiveDistance = max(0, d − acc_prev − acc_now)`, `speed = effectiveDistance / max(Δt, 1 s)`.

AC: 1. A fix with poor accuracy is rejected, no rules are evaluated, and the state is unchanged except `lastAttemptAt`. 2. A fix older than `maxFixAgeSeconds`, or more than 30 s in the future, is rejected. 3. An impossible jump (Zürich → New York in 1 h) is flagged and handled according to `onImplausible`. 4. `random` uses an injected RNG (deterministic in tests). 5. Check-ins faster than `minIntervalSeconds` are rejected with `rate_limited`.

## F9 – Privacy

`privacy.coordinates: "zone_only" | "exact"` (default `zone_only`).
- `zone_only`: the history stores the zones matched, the accuracy, and the outcome; **no coordinates**.
  The engine state keeps the last accepted position **rounded to 3 decimals (~110 m)**, which is needed for speed and travel.
- `exact`: the history stores lat/lng, and the keyholder sees a map of the check-ins.
- The wearer can downgrade to `zone_only` at any time. The downgrade redacts existing history coordinates and cannot be undone during the session.
- `extension_session.deleted` → the history is purged from KV.

AC: 1. A zone-only record has no lat/lng. 2. The downgrade redacts history. 3. A keyholder cannot upgrade during a session (API returns 403). 4. The delete webhook purges the history.

## F10 – Main page (wearer and keyholder)

- **Wearer:** big *Check in* button; status cards (next required check-in deadline with
  countdown, hunt progress and hint, travel progress, last result); explanation of
  what each zone does (forbidden zones are listed so the wearer knows the rules); privacy setting.
- **Keyholder:** the same status read-only, plus the check-in history (map if `exact`),
  failed consequences, and a link to edit the configuration.
- Geolocation errors (permission denied, timeout) show actionable help (iOS:
  Settings → Privacy → Location Services → Safari / Chaster). A fallback button opens
  the page in a new tab when the iframe is not allowed to use geolocation.
- The page also works in `?demo` mode, without Chaster, against the in-browser mock backend.

AC: 1. The hash token is parsed (URI-encoded JSON). 2. Role-specific rendering. 3. Error messages for geolocation codes 1/2/3.

## F11 – Configuration page

- Leaflet map (OSM tiles) with address search (Nominatim), click to add a zone, drag the marker, radius slider.
- Sections per rule (F2–F6), each with a consequence list editor (F7) and anti-cheat (F8) and privacy (F9) settings.
- Live validation using the shared zod schema; the Chaster *Save* button saves through the worker.
- Implements the postMessage protocol (`capabilities`, `partner_configuration_save`, `save_loading|success|failed`).

AC: 1. Sends `capabilities` on load. 2. On save: valid config → `save_loading`, then `save_success`; invalid → `save_failed` with errors shown. 3. Messages from origins other than Chaster's are ignored.

## F12 – Lock page integration (metadata)

After each check-in or tick, the worker sets:
- `homeActions`: one action `checkin`, titled "Check in" with the next deadline as description and the badge `!` when overdue.
- `reasonsPreventingUnlocking`: the hunt is incomplete (F6) and/or a required check-in is overdue.

AC: the metadata reflects the state after each evaluation.

## F13 – Demo mode

`?demo` on the main or config page uses `MockBackend`, which runs `packages/core` in
the browser with localStorage persistence. It lets a user simulate a position (click on the map) or use the real GPS.

---

## F14 – Background tracking (OwnTracks)

Background location is impossible for web pages, so Lockation accepts positions from the
open source app **OwnTracks** (iOS and Android) in its HTTP mode. Decision (2026-11-23): use OwnTracks first;
our own companion app is a later option.

Config `tracking: {enabled, heartbeatMinutes (15–10080, default 20; min. 15 = three cron runs), onHeartbeatMissed[], entryConfirmMinutes (0–120, default 3), maxDelayMinutes (default 1440), countsAsCheckin (default true), liveOnly (default false, see F16)}`.

**Pairing.** The wearer taps *Set up background tracking* on the main page. The worker creates
device credentials (random username and password; KV stores only `sha256(password)`) bound to the session
and returns an OwnTracks provisioning link `owntracks:///config?inline=<base64 .otrc>` with
`{_type:"configuration", mode:3, url:"<worker>/track/owntracks", auth:true, username, password, deviceId:"lockation", tid:"LO", monitoring:1, locatorDisplacement:100, locatorInterval:300}`.
Pairing again revokes the previous device. *Stop background tracking* deletes the device. The heartbeat keeps running, so stopping while
tracking is required has consequences.

**Ingest.** `POST /track/owntracks` (HTTP Basic auth with the device credentials):
- `_type:"location"` → observation `{lat, lon, acc, tst·1000}`.
- `_type:"transition"` → with `lat/lon`: an observation, and the zone named in `desc` is forced to enter or leave. Without `lat/lon`: only a presence change for that zone.
- Any other `_type` → ignored. The response is `[]`, or `[{_type:"cmd", action:"setWaypoints", waypoints:{_type:"waypoints", waypoints:[…]}}]`
  whenever the lock's zones changed (`desc` = zone name, `rad`, stable `tst` derived from the zone id).
  Hunt checkpoints are **never** sent.

**Evaluation of tracked observations** (`evaluateTracked`):
- Every authenticated message counts as a heartbeat: `nextHeartbeat = now + heartbeatMinutes`.
- Rejected without consequences: out of order (older than the last accepted position), older than `maxDelayMinutes`,
  more than 30 s in the future, accuracy worse than `maxAccuracyM`, implausible speed (always plain reject; no penalty, no picture).
  The manual rate limit does not apply.
- Rules are evaluated at the observation time (queued positions are evaluated when they happened).
- **Presence with hysteresis:** a zone is entered when the position is inside (match mode). It is left only when
  the position is *clearly* outside (`distance − accuracy > radius`); in between, the previous state is kept.
- Required check-in: a tracked position inside a required zone counts as a valid check-in if `countsAsCheckin` (or `liveOnly`).
  It only resets the deadline – except the first valid tracked position after a missed deadline, which also applies `onSuccess`
  (so "freeze when missed, unfreeze on success" works without manual check-ins). Tracked positions never trigger `onOutside`.
- Forbidden zones: triggered once presence has lasted `entryConfirmMinutes`, either at an inside observation or when leaving (duration ≥ confirm).
- Reward zones: `reward.dwellMinutes` (default 0). With dwell > 0, the reward needs that much continuous presence (inside observation or leave). Manual check-ins use the same presence data.
- Hunt: a tracked position inside the current checkpoint completes it. Tracked positions are never wrong guesses.
- Travel: tracked positions add distance like check-ins (real routes instead of straight lines).
- Random or always verification pictures apply only to manual check-ins.
- History: a tracked observation is recorded only if it changed presence, triggered consequences, or advanced the hunt.

**Heartbeat (cron).** If `now ≥ nextHeartbeat`, apply `onHeartbeatMissed` and advance by `heartbeatMinutes`
(at most 10 per tick, stable idempotency key `heartbeat:<deadline>`). The first heartbeat deadline is session start + heartbeat,
so tracking that is never set up is penalised too.

AC: 1. Pairing returns a valid provisioning link (base64 JSON with mode 3 and the worker URL), and re-pairing revokes the old credentials.
2. Wrong credentials → 401. 3. A location inside a forbidden zone triggers only after `entryConfirmMinutes` of presence (or on leave after that duration).
4. Hysteresis: a position on the border (inside the accuracy margin) keeps the previous presence. 5. Reward dwell is respected.
6. A tracked position counts as a required check-in and never as a wrong hunt guess. 7. Out-of-order and too old positions are ignored, but still count as a heartbeat.
8. A missed heartbeat is applied once per interval. 9. Waypoints are pushed only when the zones changed, and never contain hunt checkpoints.
10. The delete webhook removes the device credentials.

## F15 – Curfew (needs F14)

> **Superseded (implemented 2026-11-23):** curfew was merged into per-zone time windows of required ("must stay inside") and forbidden zones and removed as a separate rule; v1 curfew configs are migrated – see backlog *Curfew merged into zone time windows* in `05-iterations.md`.

Config `rules.curfew: {enabled, zoneIds[], start "HH:MM", end "HH:MM", cooldownMinutes (default 60), onOutside[]}`.
During the window (lock timezone, may cross midnight), any accepted observation (tracked or manual) that is not inside any curfew zone
applies `onOutside`, at most once per cooldown. Validation: needs at least one zone, and `tracking.enabled` must be true.

AC: 1. Outside during the window → consequences, with cooldown. 2. Outside the window or inside a zone → nothing. 3. Validation errors without tracking or without zones.

## F16 – Live tracking only (needs F14)

Decision (2026-11-23): the keyholder can require live tracking and disable manual check-ins completely.

Config `tracking.liveOnly: boolean` (default false). Validation: needs `tracking.enabled`.

Behaviour when `tracking.enabled && tracking.liveOnly`:
- `POST /api/checkin` → `403 manual_disabled`; nothing is evaluated, logged or stored. The engine also rejects
  manual check-ins with reason `manual_disabled` (defence in depth, used by the demo).
- Tracked positions always count as required check-ins (`countsAsCheckin` is treated as true).
  The first valid tracked position after a missed deadline applies `required.onSuccess` once (recovery).
- Hunt checkpoints are completed only by walking into them; there are no wrong guesses.
- `antiCheat.verificationPicture` (always/random) has no effect, because it applies to manual check-ins only.
- Main page: no check-in or hunt-guess button; a notice explains live-only mode and points to the pairing card.
- Lock page action: title *GPS live tracking*; description *Set up live tracking!* (with **!** badge) until a phone is paired,
  then *Be in a required zone by HH:MM* / *Required location overdue!* / *Live tracking active*.
- Rule summary shown to the wearer: *Live tracking (required) – Manual check-ins are disabled*.

AC: 1. `liveOnly` without `tracking.enabled` is a validation error. 2. Manual check-ins are rejected (403 in the worker, `manual_disabled`
in the engine) without consequences or history. 3. Tracked positions reset the required deadline even with `countsAsCheckin: false`.
4. After a missed deadline, the first valid tracked position applies `onSuccess` exactly once. 5. Hunt checkpoints complete via tracking.
6. View and lock page metadata reflect live-only mode.

## F18 – Disclaimer and safety notice

Decision (2026-11-23): users (keyholders and wearers) must be told clearly that Lockation is beta software used at their own risk.

- **Disclaimer page** `docs/guide/disclaimer.md` (version 1): beta / no warranty, own responsibility and limitation of liability
  "as far as permitted by law", safety first (Chaster emergency unlock, never follow a rule into danger, traffic and laws),
  GPS inaccuracy, adults only with consent, not affiliated with Chaster, third-party services, MIT licence.
- Linked from: guide sidebar, footer of every docs page, footer of the check-in and config pages, the wearer's rule summary,
  the Handlebars configuration description and the extension description in the Chaster developer portal, README.
- **Keyholder confirmation:** config `disclaimer?: {version, acceptedAt}`. The config page shows the tick box
  *"I have read the disclaimer and use Lockation at my own risk"*; saving is refused while it is not ticked – in the page
  (Chaster save → `save_failed`), in the worker (`400 disclaimer_required`) and in the demo backend.
  Reading stored configs without it keeps working. Bumping `DISCLAIMER_VERSION` asks keyholders again on their next save.

AC: 1. Save without accepted disclaimer → refused (page, worker 400 `disclaimer_required`, demo). 2. Save with it → stored.
3. Old configs without the field still parse. 4. The disclaimer is linked from the docs footer, the app footers and the wearer's rule summary.

## F19 – Mobile layout, live position, real tracking status, access control (2026-11-23)

- **Layout:** designed for Chaster's extension frame, **max. 618 px** wide (down to ~360 px phones). The page never scrolls
  horizontally (`overflow-x: hidden`, long texts wrap); the config tab bar scrolls horizontally on its own (swipe).
- **Live position on the map (wearer):** while the page is open, `watchPosition` shows the wearer's live position (purple, with
  accuracy circle). Starts automatically only if the permission is already granted, otherwise via *Show my current location*;
  also starts after a check-in. Local only – nothing is sent to the server by itself.
- **Last reported position:** `SessionView.lastPosition` (from `state.lastAccepted`) – always for the wearer (rounded in
  zone-only mode, flagged `approximate`), for the keyholder **only with exact sharing**; otherwise the keyholder sees the names of
  the zones the wearer is currently in.
- **Tracking status:** `trackingStatus()` → `not_set_up` | `waiting` (paired, no location from this pairing yet) | `connected`
  (location within `heartbeatMinutes`) | `no_signal`. Previously "connected" was shown right after pairing.
- **Access control:** `/api/session` and all main-page endpoints accept only the roles `wearer` and `keyholder`
  (`403 not_allowed` otherwise).
  The configuration endpoints (`/api/config/get`, `/api/config/save`, `/api/capabilities` with a configuration token) apply
  the same check (to verify in the end-to-end test that Chaster uses only these role names while a lock is being created).
- **Lock history keeps zone names** (decided 2026-11-23): custom log entries continue to name zones ("Entered *Bar*");
  wearer and keyholder accept that the Chaster lock history may show them.

AC: 1. A role other than wearer/keyholder gets 403 without any zone or position data. 2. Status is `waiting` after pairing and
`connected` after the first location; a location from an earlier pairing doesn't count. 3. Keyholder sees `lastPosition` only
with exact sharing; the wearer always (approximate in zone-only mode).

## F20 – Configuration v2 (2026-11-23)

Implements the backlog items marked *implemented* in `05-iterations.md`. Summary:

- **Zones** carry roles (`required` and/or `reward`, or `forbidden`, or none = neutral), an optional match mode and per-zone
  settings for each role. Rule tabs list only zones of their role; per-zone values override the rule values.
- **Required**: one deadline per zone (`combine: each`; v1 locks keep `any`), optional "anywhere" deadline, grace default 5 min,
  optional warning before deadlines, per-zone extra lists, **stay windows** (former curfew, F15) with weekday filter.
- **Forbidden**: escalation timeline (warning 2′, penalty 10′, every 5′, warning 1′ after each penalty; all per zone, warnings
  can be off), re-entry within the repeat time continues the visit, time windows, per-zone extra punishment, consequence
  scheduling `when: every | everyNth | nth`. Without tracking: immediate penalty, repeated at most every 5 min.
- **Reward**: per-zone cooldown, daily cap, minimum stay, extra reward; the rule cap is overall.
- **Hunt**: reveal `all` (default; no wrong guesses), order `sequence | any`, visible checkpoints synced to OwnTracks.
- **Tracking**: OwnTracks mode `auto | move | significant` (pushed with `setConfiguration`), missing-signal quiet hours and warning.
- **Notifications** via ntfy for the wearer (warnings, rules changed) and the keyholder (switchable events).
- **Live-only random verification pictures** (`antiCheat.liveVerificationEveryHours`).
- **Reachability check** (F17) with per-point confirmation stored as `reachabilityAck`.
- **Storage** on D1; 1-minute cron for due sessions.
- **Migration**: `migrateConfig` (v1 → v2, behaviour preserving) and `migrateState`; covered by the v1 test suite.
