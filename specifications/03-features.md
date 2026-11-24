# 03 – Feature Specification (current state)

This is the current behaviour of Lockation. Each area has a stable feature ID (F1 …) and acceptance criteria (AC). The ACs
are covered by automated tests (`packages/core/test`, `apps/worker/test`, `apps/web/test`); test `describe` blocks
reference the feature IDs. How the features got here is in [CHANGELOG.md](CHANGELOG.md); the old numbering is mapped in
[§ Feature ID mapping](#feature-id-mapping). Shapes are in [04-data-model-and-api.md](04-data-model-and-api.md).

**Terms.** *Fix* = one GPS reading. *Check-in* = a fix the wearer submits from the main page. *Background location* = a
position sent by OwnTracks. *Observation* = either of them. *Accepted* = passed anti-cheat. *Clearly outside* = `distance −
accuracy > radius` (leave hysteresis). All times of day (windows, quiet hours, daily caps, scheduled hunt start) are in the
lock's `timezone`.

---

## Zones and places

### F1 – Zones, roles and geofence matching

- A zone is a circle `{id, name, lat, lng, radiusM}` with **20 m ≤ radius ≤ 50 km**; the editor shows a hint below 100 m
  (indoor GPS is often less precise). Zone ids are unique.
- A lock has at most **20 places in total** (zones + hunt checkpoints, `MAX_PLACES`) – the iOS limit of monitored regions
  per app, so every visible place can be synced to OwnTracks. The editor shows "N / 20 places used" and blocks adding more;
  validation: "at most 20 zones and hunt checkpoints in total (currently N)".
- **Roles:** `required` and/or `reward`, or `forbidden`, or none (*neutral*). `forbidden` excludes every other role. A rule
  tab lists only the zones of its role; per-zone values override the rule values. Dropping a role removes the zone's
  settings for that role (confirm dialog if there are any).
- Distance: haversine in metres (Earth radius 6 371 008.8 m).
- **Match mode** per lock (`matchMode`, default `lenient`), overridable per zone and per checkpoint:
  - `lenient`: inside ⇔ `distance ≤ radius`;
  - `strict`: inside ⇔ `distance + accuracy ≤ radius`.
  Leaving always uses the hysteresis rule (clearly outside), independent of the mode. Giving a zone the forbidden role
  suggests `strict` unless a mode was chosen.

AC: 1. Haversine within 0.5 % of reference values (Zürich→Bern ≈ 95.5 km; 0 for identical points). 2. Lenient: a fix on
the border is inside; strict: a fix whose accuracy circle crosses the border is outside. 3. Radius < 20 m or > 50 km,
duplicate ids, `forbidden` combined with another role and more than 20 places are rejected. 4. Per-place match mode
overrides the lock mode; without it the lock mode applies.

### F17 – Reachability safety check

Every zone and checkpoint is checked in the config page when it is added, moved or resized (debounced):

| Check | Source (free, no key) | Flag when |
|---|---|---|
| Water | OSM Overpass (`natural=water`, `waterway=riverbank`, `water=*`) | the place is entirely in water |
| Sea | Nominatim reverse (`zoom=10`) has no land result | centre is offshore |
| Glacier / cliff / bare rock | Overpass | entirely inside / centre on it |
| Restricted area | Overpass (`landuse=military`, `aeroway=aerodrome\|runway`, `railway=rail`) | entirely inside, or centre on runway / track |
| No access | Overpass: no `highway=*` within radius + 100 m | nothing walkable nearby |

- "Entirely" = centre + 8 sample points at 0.7 × radius all fail; partial failures give a non-blocking info note.
- There is no altitude check. Results are cached in `sessionStorage`; Nominatim ≤ 1 req/s. Only the keyholder's place
  coordinates are sent to OSM services, never wearer locations. An unreachable service → "could not be checked", not blocking.
- **One shared confirmation** ("I know – these places are intentionally hard to reach") covers all flagged places; it is
  stored per place as `reachabilityAck {reasons, at}`. Moving/resizing re-runs the check; changed reasons clear the ack.
  Saving is blocked (Chaster save → `save_failed`) while a flagged place is unconfirmed. The worker validates only the shape.
- The wearer sees confirmed places with the reason ("⚠ This zone is in a lake – confirmed as intentional by the keyholder");
  hidden hunt checkpoints only produce a generic note ("one checkpoint is in difficult terrain").

AC: 1. Sample-point logic (all / some / none failing). 2. Parsers work on recorded API responses. 3. Save blocked until
confirmed; one confirmation acknowledges all flagged places. 4. Ack cleared when reasons change. 5. Service failure is
non-blocking. 6. Wearer texts never reveal hidden checkpoints.

---

## Rules

### F2 – Required zones

Rule `rules.required`: `enabled`, `anywhere`, `intervalMinutes` (default 240), `graceMinutes` (default **5**),
`quietHours?`, `warnBeforeMinutes?`, `onSuccess`, `onOutside`, `onMissed`, `onOutsideDuringWindow`, `windowCooldownMinutes`
(default 60). Per zone: `intervalCheckins` (default true), `intervalMinutes?`, `graceMinutes?`, `stayWindows`, extra
`onMissed`, `onSuccess`, `onOutsideDuringWindow`.

**Interval check-ins – each required zone has its own deadline** ("Home every 4 h **and** Work every 8 h"); a check-in at
Home doesn't reset Work. With `anywhere` there is an additional deadline that any accepted observation satisfies ("check in
anywhere": the wearer only proves their position regularly, which makes forbidden zones enforceable). Zones without own
values use the rule defaults. Deadlines are stored as slots (`*` = anywhere, else the zone id).

- `deadline = (lastValid ?? sessionStart) + interval`; a deadline inside quiet hours moves to the end of quiet hours
  (windows may cross midnight).
- An accepted observation inside the zone is *valid*: applies `onSuccess` (rule list + zone list) and resets the deadline.
  Background locations count as check-ins whenever tracking is on (F14); they reset the deadline silently, except the first
  valid one after a missed deadline, which applies `onSuccess` once (recovery, per zone).
- A **manual** check-in outside all required zones applies `onOutside` once (not per zone) and resets nothing. Background
  locations never trigger `onOutside`.
- The cron applies `onMissed` (rule list + zone list, `when` scheduling) once when `now ≥ deadline + grace`; the next
  deadline is `previous + interval`, so every further missed interval is penalised again (at most 10 per tick).
- Optional warning `warnBeforeMinutes` (≥ 5, < interval) before each deadline, at most once per deadline.
- Minimum interval: **3 min** when background locations count, otherwise **5 min**.

**Stay windows ("must stay inside").** `stayWindows: {start, end, days?}[]` (≤ 10 per zone, may cross midnight; a window
belongs to the day it starts; no `days` = every day). Needs background tracking (validation error otherwise). During an
active window, an accepted observation that is clearly outside applies `onOutsideDuringWindow` (rule + zone lists), at most
once per `windowCooldownMinutes`. Being inside **any** required zone with an active window satisfies all active windows.
A zone with `intervalCheckins: false` has only stay windows.

AC: 1. A valid check-in resets only that zone's deadline to `now + interval`. 2. A manual outside check-in applies
`onOutside` once and leaves deadlines unchanged. 3. `onMissed` once per missed interval, also when the tick runs
repeatedly; after 3 missed intervals the next tick applies it 3 times (cap 10). 4. Quiet hours move deadlines, including
across midnight. 5. Recovery applies `onSuccess` exactly once. 6. The warning is sent once and never at/after the deadline.
7. Stay window: outside → consequence with cooldown; inside any active zone → nothing; weekdays and midnight crossing
respected. 8. Stay windows without tracking are rejected.

### F3 – Forbidden zones

Rule `rules.forbidden`: `firstWarningAfterMinutes` (default **2**, `null` = off), `firstPenaltyAfterMinutes` (**10**),
`repeatEveryMinutes` (**5**, ≥ 5), `repeatWarningAfterMinutes` (**1**, `null` = off), `onEnter`. Each value can be
overridden per zone; per zone also `windows` and an extra `onEnter` list.

- **Escalation timeline** with background tracking: enter 0′ → ⚠ 2′ → ❌ 10′ → ⚠ 11′ → ❌ 15′ → ⚠ 16′ → ❌ 20′ … until the
  wearer is clearly outside. Warnings tell the remaining time and the consequence ("leave within 8 min or +1 h").
- Each penalty applies the rule list, then the zone's extra list. Each consequence can be scheduled with
  `when: every` (default) | `everyNth: n` | `nth: n` (e.g. pillory every 3rd, freeze only at the 4th penalty).
- Leaving and re-entering within `repeatEveryMinutes` continues the visit (no reset by stepping out and in).
- While inside, the wearer counts as inside as long as the last inside location is not older than the missing-signal time;
  afterwards the escalation pauses and the missing-signal rule takes over.
- **Windows:** without windows the zone is always forbidden; with windows only while one is active. A visit already inside
  at window start begins its timeline at window start.
- Without tracking (manual check-in inside): immediate penalty, repeated at most every `repeatEveryMinutes`.
- Validation: warnings strictly before the next penalty (`firstWarning < firstPenalty`, `repeatWarning < repeatEvery`).
- The editor shows the resulting timeline and the cost of a 1-hour stay.

AC: 1. Default timeline: warnings and penalties at 2/10/11/15/16/20 … min. 2. Per-zone values are independent. 3. Re-entry
within the repeat time continues; leaving stops. 4. No warning at or after a penalty time; switched-off warnings are not
sent. 5. `every` / `everyNth` / `nth` over a 1-hour stay. 6. Manual check-in → immediate penalty. 7. Windows and visits
spanning a window start. 8. Idempotency keys per zone, visit and penalty number.

### F4 – Reward zones

Rule `rules.reward`: `cooldownMinutes` (720), `maxPerDay` (1, overall cap across all reward zones per calendar day),
`dwellMinutes` (0), `onEnter`. Per zone: `cooldownMinutes?`, `maxPerDay?`, `dwellMinutes?`, extra `onEnter`.
An accepted observation inside a reward zone applies the reward after the minimum stay (continuous presence), limited by
the zone cooldown, the zone's daily cap and the overall cap.

AC: 1. Reward applied. 2. Zone cooldown and zone cap independent per zone. 3. Overall cap respected and reset the next day.
4. Dwell respected (inside observation or leave after the dwell time).

### F21 – Zone actions (enter / leave)

Every zone, whatever its role (neutral too), can have `actions {onEnter, onLeave, minStayMinutes, cooldownMinutes}`.
*Enter* = presence starts; *leave* = clearly outside after a stay of at least `minStayMinutes` ("45 min at the gym →
−1 h"). Each action runs at most once per `cooldownMinutes`; idempotency keys are stable per visit.

AC: 1. Enter and leave fire once per visit. 2. Leave before the minimum stay does nothing. 3. Cooldown respected.
4. Works for neutral zones.

### F5 – Travel goals

Rule `rules.travel`: `stepKm` (1), `maxKmPerCheckin` (50), `dailyCapKm` (100), `onStep`. The distance between
consecutive accepted observations is added to `pendingKm` (capped). For every full `stepKm`, `onStep` applies; time
consequences are scaled by the number of steps, other types apply once per observation. Background locations give real
routes instead of straight lines.

AC: 1. 2.5 km with step 1 km → 2 steps, 0.5 km carried over. 2. Caps respected. 3. An implausible-speed observation adds
no distance.

### F6 – Scavenger hunt

Rule `rules.hunt`: `checkpoints[{id, name, lat, lng, radiusM, hint, matchMode?}]`, `reveal`, `order`, `start`,
`startAt?` / `startAfterMinutes?`, `pauseBy`, `wearerCanAbort`, `timeLimitMinutes?`, `blockUnlockUntilComplete`,
`wrongCooldownMinutes`, `onCheckpoint`, `onWrong`, `onComplete`, `onTimeout`, `onAbort`.

- **Reveal:** `all` (default) = hint + all checkpoints pinned on the map with status; `map` = hint + pin of the current
  (or open) checkpoint; `distance` = hint + distance band (`< 200 m`, `< 500 m`, `< 1 km`, `< 5 km`, `> 5 km`); `hint` =
  hint only.
- **Order:** `sequence` (default) – only the current checkpoint counts, walking through a later one does nothing; `any` –
  every unfound checkpoint counts. `onCheckpoint` per find, `onComplete` when all are found.
- **Wrong guesses:** with `hint` / `distance` / `map` the wearer can submit a hunt guess; a guess outside the target applies
  `onWrong` (cooldown). With `all` there are no guesses. Background locations are never wrong guesses.
- **Start:** `auto` (with the lock), `wearer`, `keyholder` or `scheduled` (`startAt` = local date-time **in the lock's
  timezone**, or `startAfterMinutes` after the lock start; run by the cron). The keyholder can always force-start. On a
  self-lock the wearer may always start.
- **Pause:** `pauseBy: nobody | keyholder (default) | both`. A pause stops the time limit; checkpoints don't count and are
  hidden before the start and while paused.
- **End:** the keyholder can end the hunt without consequences (`aborted`). With `wearerCanAbort` the wearer can give up:
  status `failed`, `onAbort` applies.
- Optional time limit (extended by paused time): the cron applies `onTimeout` once and fails the hunt.
- `blockUnlockUntilComplete` adds an unlock blocker until the hunt is completed, failed or aborted.
- **OwnTracks sync:** visible checkpoints are pushed as waypoints `"Hunt <n>: <name>"` – `all`: all unfound; `map`: the
  current/open one; `hint` / `distance`: none. An *enter* transition completes the checkpoint like a position inside it.
  Found checkpoints are removed with the next push.
- Hidden checkpoints (coordinates, names) are never sent to the wearer or to OwnTracks.

AC: 1. Sequence advances in order; the last checkpoint completes. 2. Any-order counts every open checkpoint. 3. `onWrong`
with cooldown; no guesses with `all`. 4. With `hint` / `distance` / `map` no hidden checkpoint data reaches the wearer
view; with `all` the full list is sent. 5. Timeout once, extended by pauses. 6. Start modes, scheduled start in the lock
timezone, pause permissions, keyholder force-start and penalty-free end, wearer abort with `onAbort`. 7. Unlock blocker set
while open, cleared afterwards. 8. Waypoints per reveal mode, re-push after a find.

### F7 – Consequences

| type | params | Chaster call |
|------|--------|--------------|
| `add_time` / `remove_time` | `seconds` (1 … 31 536 000) | `POST /sessions/{id}/action` |
| `freeze` | `durationMinutes?` (timed → the cron unfreezes) | action `freeze` |
| `unfreeze` | – | action `unfreeze` |
| `pillory` | `durationMinutes` (5–1440), `reason` | action `pillory` |
| `log` | `message` | custom log only |
| `task` | `task`, `points`, `verificationRequired`, `durationMinutes?` | `POST /sessions/{id}/tasks/assign` |
| `verification_picture` | – | `POST /sessions/{id}/verification-picture/request` |
| `command` | `commandId` (`<slug>.<name>`), `input`, `label?` | `POST /sessions/{id}/actions/{commandId}` (experimental) |

- Every consequence may carry `when` (F3); in lists that don't repeat it has no effect.
- One evaluation writes **one** custom log entry that summarises events and consequences.
- A failing consequence never aborts the others; the failure is recorded and shown to the keyholder.
- `command`: the config page lists the lock's discovered capabilities (or known public manifests before the lock exists).

AC: 1. Each type maps to the right request. 2. Broker commands carry an idempotency key. 3. One failure → the others still
run and the record lists the error.

### F8 – Anti-cheat and verification pictures

`antiCheat`: `maxAccuracyM` (100), `maxFixAgeSeconds` (120), `maxSpeedKmh` (200), `onImplausible`
(`reject` | `reject_and_penalize` | `accept_and_verify`), `implausibleConsequences`, `verificationPicture`
(`never` | `always` | `random`), `verificationProbability` (0.2), `minIntervalSeconds` (60), `liveVerificationEveryHours?`.

- Manual check-ins: rate limit → stale / future timestamp (> 30 s) → accuracy → speed → accept.
  Speed: `max(0, d − acc_prev − acc_now) / max(Δt, 1 s)`.
- Background locations: out of order, older than `maxDelayMinutes`, future, bad accuracy or implausible speed are
  rejected without consequences (no rate limit, no picture).
- `verificationPicture` applies to manual check-ins only. **Live-only locks** (`checkins: auto`) can request a random
  verification picture on average every `liveVerificationEveryHours` (cron-based); the option requires `auto`.

AC: 1. Bad accuracy → rejected, rules not evaluated, state unchanged except `lastAttemptAt`. 2. Too old / future fixes
rejected. 3. An impossible jump is handled per `onImplausible`. 4. `random` uses an injected RNG. 5. Faster than
`minIntervalSeconds` → `rate_limited`. 6. Live verification only with `auto`, at random times around the average.

---

## Location sources

### F14 – Background tracking (OwnTracks) and check-in mode

Web pages can't track in the background, so Lockation accepts positions from **OwnTracks** (iOS / Android) in HTTP mode.

`tracking`: `enabled`, `checkins` (`both` | `auto`), `heartbeatMinutes` (default **20**, min 15), `onHeartbeatMissed`,
`maxDelayMinutes` (1440), `owntracksMode` (`auto` | `move` | `significant`), `quietHours?`, `warnBeforeMinutes?`.

**Check-in mode** ("How is the location collected?"):

| Setting | Meaning |
|---|---|
| tracking off | manual check-ins only |
| `both` (default) | manual check-ins **and** background locations; both count as required check-ins |
| `auto` | background only ("live tracking only"): manual check-ins are disabled |

With `auto`: `POST /api/checkin` → `403 manual_disabled` (the engine rejects too, for the demo); no check-in or guess button;
the main page explains the mode; the lock page action reads *GPS live tracking* (*Set up live tracking!* until paired).

**Pairing.** *Set up background tracking* creates device credentials (random username/password; D1 stores only the
SHA-256 hash) and returns `owntracks:///config?inline=<base64 .otrc>` (mode 3, worker URL, auth, `monitoring`,
`locatorInterval`) plus a QR code. Re-pairing revokes the old device; *Stop* deletes it (the missing-signal rule keeps
running). The setup is **confirmed by a manual send**: the status becomes *connected* only after the first location with
trigger `t: "u"` (user tapped publish) since pairing (`verifiedAt`). Automatic locations are evaluated meanwhile
(`receiving`); the setup panel polls every 5 s and shows "Setup complete". The guide explains *Allow external
configuration* on iOS.

**OwnTracks mode.** `auto` → *move* (`monitoring: 2`) if the missing-signal time is < 60 min, forbidden zones exist or the
report interval is < 300 s; else *significant* (`monitoring: 1`). Report interval (move mode) = half the shortest required
interval when background locations count, clamped to 120–300 s. A change is pushed with `setConfiguration`
(`monitoring` + `locatorInterval`) in the next response, so no re-pairing is needed.

**Ingest** (`POST /track/owntracks`, Basic auth with device credentials): `location` → observation; `transition` → presence
change for the zone or checkpoint named in `desc` (plus an observation if it has coordinates); other types ignored. The
response carries `setWaypoints` when zones / visible checkpoints changed, and/or `setConfiguration`.

**Evaluation.** Every authenticated message is a heartbeat. Rules are evaluated at observation time. Presence uses
hysteresis (enter = inside per match mode; leave = clearly outside). A tracked observation is recorded in history only if
it changed presence, triggered consequences or advanced the hunt.

**Missing signal.** If no location arrives by `nextHeartbeat`, `onHeartbeatMissed` applies (`when` scheduling, ≤ 10 per
tick, key `heartbeat:<deadline>`) and the deadline advances. The first deadline is session start + heartbeat, so tracking
that is never set up is penalised too. Quiet hours: no penalty or warning inside; a deadline inside moves to the end + one
full period. Warning `warnBeforeMinutes` (10 ≤ N < heartbeat) once per period, only while `now < nextHeartbeat` (a late cron
skips it). The tracking card shows a live countdown to the next expected location (`signalDueAt`) and the delay.

**Status:** `not_set_up` | `waiting` (paired, not confirmed) | `connected` (confirmed, location within the missing-signal
time) | `no_signal`.

AC: 1. Pairing link is valid base64 JSON with mode 3, worker URL, monitoring and interval; re-pairing revokes old
credentials. 2. Wrong credentials → 401. 3. Hysteresis keeps presence on the border. 4. Background locations count as
required check-ins and are never wrong guesses. 5. Old / out-of-order locations are ignored but count as heartbeat.
6. Missed heartbeat once per interval; quiet hours and warning rules. 7. Waypoints pushed only on change, never hidden
checkpoints. 8. `setConfiguration` pushed once after a mode / interval change. 9. Status `connected` only after a manual
send from the current pairing. 10. `auto` rejects manual check-ins with 403 and no history. 11. The delete webhook removes
the device.

---

## Notifications and communication

### F22 – Notifications (ntfy)

- Delivery via **ntfy** (free app). *Set up warnings* (wearer) / *Set up notifications* (keyholder) creates a random secret
  topic per session and audience, shows `ntfy://` subscribe link + QR code and sends "✅ Lockation test notification";
  *Send test* (`/api/notify/test`) sends another; *Stop* deletes the topic; the delete webhook removes it with the session.
- The worker posts with the `NTFY_TOKEN` account token (`Authorization: Bearer`); base URL `NTFY_BASE` (default
  `https://ntfy.sh`). Without the token, notifications are off and the UI hides the setup.
- **Wearer:** forbidden-zone warnings, required-deadline warnings, missing-signal warnings, rules changed. High priority for
  "penalty in < 5 min"; the click URL opens the check-in page. Every warning is also written to the lock history.
- **Keyholder** (switchable, defaults): penalty [on], forbidden zone entered [on], tracking set up / stopped / missing signal
  [on], required missed [on], required done [off], hunt events [on], reward [off], verification picture [on]. At most one
  per event type and zone per 5 min; bursts in one evaluation are combined. Self-locks: only the wearer setup is offered.
- Texts contain zone names and consequences, **never coordinates**; hidden hunt checkpoints are not named to the wearer.

AC: 1. Subscribe / test / unsubscribe; 409 without subscription, 503 without token. 2. Per-event switches, combining,
rate limit. 3. No coordinates in any text. 4. Topics removed on delete.

### F23 – Configuration changes during a lock

Changes apply immediately. On save with a running session, `diffConfig(old, new)` summarises them (zones added / removed /
moved / resized, roles, rules on/off, timings, consequence lists changed) and the worker writes the summary to the lock
history, notifies the wearer (ntfy) and stores it as `rulesChanged`. The wearer's page shows "Rules changed <time>" with
the summary until acknowledged (`/api/notice/ack`). Hidden checkpoints appear only as "hunt checkpoints changed".

AC: 1. Diff text per change type; nothing for identical configs. 2. Hidden checkpoints not revealed. 3. Log + notification
+ notice on save; ack clears the notice.

---

## Pages

### F10 – Main page (wearer and keyholder)

- **Wearer:** *Check in* button (unless `auto`); status cards: required deadlines per zone with countdown, forbidden visits
  with the next penalty, hunt progress / map / controls, travel, tracking, notifications, last result; rule summary
  (forbidden zones listed so the wearer knows the rules, today's windows); privacy setting; rules-changed notice.
- **Live position:** while the page is open, `watchPosition` shows the wearer's position locally (starts automatically
  only if permission is already granted, otherwise via *Show my current location*). Nothing is sent by itself.
- **Last reported position** (`lastPosition`): always for the wearer (rounded and flagged `approximate` in zone-only mode);
  for the keyholder only with exact sharing, otherwise the names of the zones the wearer is in.
- **Keyholder:** same status read-only, history (map with exact sharing), failed consequences, hunt controls,
  notifications, link to the configuration.
- Geolocation errors show actionable help (iOS location settings); a fallback opens the page in a new tab when the iframe
  may not use geolocation.

AC: 1. The hash token (URI-encoded JSON) is parsed. 2. Role-specific rendering. 3. Help for geolocation error codes 1/2/3.
4. `lastPosition` visibility rules.

### F11 – Configuration page

- Tabs: Zones, Required, Forbidden, Reward, Travel, Hunt, Tracking, Notifications, Anti-cheat, Privacy, Import / Export.
  Leaflet map (OSM) with address search (Nominatim), click to add, drag, radius slider; role badges and colours; 🕑 badge for
  zones with windows; per-zone expandable editors in the rule tabs; consequence list editor with `when` where lists repeat.
- **Inline validation:** the shared zod schema runs live; each issue is shown next to its field (and the tab is marked),
  not as a list on top.
- **Disclaimer gate (F18):** until accepted, the disclaimer box is shown on the Zones tab only and no zones or checkpoints
  can be added; afterwards it disappears.
- **Settings import / export (F24):** export of the whole configuration as JSON; import validates it and keeps the current
  disclaimer acceptance.
- postMessage protocol: `capabilities` on load; on `partner_configuration_save` → `save_loading`, then `save_success` or
  `save_failed` (validation errors, unconfirmed reachability, disclaimer). Messages only from `window.parent` (and
  `VITE_CHASTER_ORIGINS` if set).

AC: 1. Sends `capabilities` on load. 2. Valid → `save_loading` + `save_success`; invalid → `save_failed` and inline
errors. 3. Foreign origins ignored. 4. No places before the disclaimer is accepted. 5. Export → import round-trip yields the
same config; invalid files are rejected.

### F18 – Disclaimer

- `docs/guide/disclaimer.md` (version 1): beta, no warranty, own responsibility, safety first (emergency unlock, never follow
  a rule into danger), GPS inaccuracy, adults with consent, not affiliated with Chaster, third-party services, MIT licence.
  Linked from docs sidebar and footer, app footers, the wearer's rule summary, the Chaster configuration description and
  the README. Contact: GitHub issues.
- Config `disclaimer {version, acceptedAt}`: required on save (page, worker `400 disclaimer_required`, demo), optional on
  read. Bumping `DISCLAIMER_VERSION` asks again on the next save.

AC: 1. Save without acceptance refused everywhere. 2. With acceptance stored. 3. Configs without the field still parse.

### F12 – Lock page integration (metadata)

After each evaluation the worker sets `homeActions` (one action `checkin`: "Check in" / "GPS live tracking", description
with the earliest deadline or status, badge `!` when overdue or not set up) and `reasonsPreventingUnlocking` (hunt open with
`blockUnlockUntilComplete`, required check-in overdue).

AC: the metadata reflects the state after each evaluation.

### F19 – Mobile layout and access control

- Designed for Chaster's extension frame: **max. 618 px** wide, down to ~360 px; no horizontal page scroll; the config tab
  bar scrolls on its own. The pages load the **iframe-resizer** child script so Chaster grows the iframe to the page height.
- All main-page and configuration endpoints accept only the roles `wearer` and `keyholder` (`403 not_allowed` otherwise,
  without zone or position data).
- Custom log entries name zones ("Entered *Bar*"); this is accepted.

AC: 1. Other roles get 403 without data. 2. Layout has no horizontal overflow at 360 px.

### F13 – Demo mode

`?demo` on the main or config page runs the full UI against the in-browser demo backend, which uses the same application
service from `packages/core` as the worker (localStorage persistence). The demo bar switches the role (wearer /
keyholder), resets the demo around the current position, links to the config page and shows the simulated Chaster lock
history. Positions: real GPS, or a **map click as fake GPS**; with tracking on, a toggle makes map clicks send fake
background locations (a click inside a zone is a normal map click where zones aren't selectable).

AC: 1. Demo works without Chaster and worker. 2. Map clicks produce check-ins / background locations through the same engine.

### F9 – Privacy

`privacy.coordinates: zone_only` (default) | `exact`.
- `zone_only`: history stores zones, accuracy and outcome, no coordinates; the state keeps the last position rounded to 3
  decimals (~110 m) for speed and travel.
- `exact`: history stores coordinates; the keyholder sees them on a map.
- The wearer can downgrade to `zone_only` at any time (redacts history; cannot be undone during the session); nobody can
  upgrade during a session.
- `extension_session.deleted` purges history, devices, topics and due entries.

AC: 1. Zone-only record has no lat/lng. 2. Downgrade redacts. 3. Upgrade during a session → 403. 4. Delete webhook purges.

---

## Feature ID mapping

| ID | Topic | Where now |
|----|-------|-----------|
| F1 | Zones and geofence matching | F1 (incl. roles, per-zone match mode) |
| F2 | Required check-in | F2 (per-zone deadlines, stay windows) |
| F3 | Forbidden zones | F3 (escalation timeline) |
| F4 | Reward zones | F4 (per zone) |
| F5 | Travel goals | F5 |
| F6 | Scavenger hunt | F6 (reveal, order, start / pause / end) |
| F7 | Consequences | F7 (`when` scheduling) |
| F8 | Anti-cheat | F8 (incl. live verification pictures) |
| F9 | Privacy | F9 |
| F10 | Main page | F10 |
| F11 | Configuration page | F11 |
| F12 | Lock page metadata | F12 |
| F13 | Demo mode | F13 |
| F14 | Background tracking | F14 |
| F15 | Curfew | removed – replaced by stay windows (F2) and forbidden windows (F3) |
| F16 | Live tracking only | F14, check-in mode `auto` |
| F17 | Reachability check | F17 |
| F18 | Disclaimer | F18 (gate in F11) |
| F19 | Mobile layout, live position, tracking status, access control | F19, F10, F14 |
| F20 | Configuration v2 | spread over F1–F8, F14, F22 |
| F21 | Zone actions | F21 (new) |
| F22 | Notifications | F22 (new ID) |
| F23 | Configuration changes during a lock | F23 (new ID) |
| F24 | Settings import / export | F11 (new ID) |
