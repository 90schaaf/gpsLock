# 05 – Iteration Plan

| It. | Scope | Done when |
|-----|-------|-----------|
| 0 | Specs, monorepo scaffolding, CI | `npm test` green on empty packages; CI workflow present |
| 1 | `packages/core`: geo (F1), config schema, anti-cheat (F8), required (F2), forbidden (F3), reward (F4), travel (F5), hunt (F6), tick, consequences planning (F7), privacy (F9) | Unit tests cover all core ACs |
| 2 | `apps/worker`: Chaster client, routes, webhook, cron, KV history, metadata (F12) | Route tests with a fake Chaster API and in-memory KV |
| 3 | `apps/web`: main page (F10), config page (F11), demo mode (F13) | Unit tests for hash parsing, the postMessage protocol, and geolocation errors; manual demo |
| 4 | Docs (VitePress): technical setup + user guide; Pages workflow; worker deploy workflow | `npm run build` produces the Pages artifact |
| 5 | Beta: deploy, register in the Chaster developer portal, testers, feedback loop | Tester lock completes a check-in end to end |

Backlog after the beta: polygons, keyholder approval queue, i18n, background
reminders via push notifications, publishing a Lockation manifest so other
extensions can react to `lockation.checked-in` events.

## Iteration 6 – Background tracking (F14, F15)

| Step | Scope |
|------|-------|
| 6.1 | Core: config/state additions, presence with hysteresis, `evaluateTracked`, curfew, dwell, heartbeat tick |
| 6.2 | Worker: pairing/unpairing, `/track/owntracks` ingest, waypoint push, device cleanup |
| 6.3 | Web: tracking card (pairing link, QR, install help), config tab *Tracking & curfew*, demo simulation |
| 6.4 | Docs: user guide *Background tracking*, privacy update, API docs |

## Iteration 7 – Live tracking only (F16)

| Step | Scope |
|------|-------|
| 7.1 | Core: `tracking.liveOnly`, manual reject, required recovery (`missedSinceValid`), view/metadata |
| 7.2 | Worker: 403 `manual_disabled` on `/api/checkin` |
| 7.3 | Web: hide check-in buttons, live-only notice, config checkbox, demo guard |
| 7.4 | Docs: guide, rules, configuration, API, Handlebars description |

## Backlog – noted improvements

### Zone matching per zone (decided 2026-11-23, implement later)

- `Zone.matchMode?: "lenient" | "strict"` and `Checkpoint.matchMode?` override the lock-wide `matchMode`, which stays the default (existing configs unchanged).
- All `isInside` callers use `zone.matchMode ?? config.matchMode`; leaving a zone keeps the hysteresis rule (`distance − accuracy > radius`) regardless of mode.
- Config editor: *Lenient / Strict* selector per zone and checkpoint; adding a zone to the forbidden rule suggests *strict* unless the keyholder already chose a mode.
- Update docs (configuration, rules), zod schema, tests (per-zone override, fallback, forbidden default suggestion).

### Zone roles in the zone overview (requested 2026-11-23, implement later)

- Each zone gets a role label in the Zones tab: **required** or **forbidden** (possibly also *reward* and *neutral*, to be decided).
- The zone list and the map show the role (badge / colour per role).
- The *Required* tab's zone picker shows only zones labelled *required*; the *Forbidden* tab shows only *forbidden* zones.
- Builds on the existing validation that a zone cannot be both required and forbidden.
- Open questions: which tab lists unlabelled zones (reward, curfew, travel)? Can curfew use *required* zones? What happens to a zone's
  rule selection when its role changes (remove it from the other rule automatically)? Migration for existing configs: derive the role
  from the rule that already uses the zone.
- Could be combined with *Zone matching per zone* (a forbidden role could suggest strict matching).

### Forbidden zones: per-zone cooldown and extra punishment (requested 2026-11-23, implement later)

- **Per-zone cooldown:** each forbidden zone gets its own cooldown, default **5 minutes** (today: one shared `cooldownMinutes`, default 60).
- **Per-zone extra punishment:** each forbidden zone can have an additional consequence list that applies on top of the rule's
  common `onEnter` list (e.g. all forbidden zones +1 h, "Casino" additionally pillory 2 h).
- Proposed shape: `rules.forbidden.zones: Record<zoneId, { cooldownMinutes?: number; onEnter?: Consequence[] }>`; the rule-level
  `cooldownMinutes` stays as the default for zones without their own value (existing configs keep working, since saved configs
  contain their explicit value).
- UI: in the Forbidden tab, each selected zone expands to show its cooldown field and an "Extra punishment" consequence editor.
  Rule summary shown to the wearer lists per-zone cooldowns and extras.
- Consideration: with background tracking a 5 min cooldown means up to one penalty per OwnTracks report while staying inside
  (roughly every 5 min); the editor should show a hint that short cooldowns repeat penalties during a longer stay.
- Tests: per-zone cooldown independent per zone, fallback to rule default, extra list added after the common list, idempotency keys per zone.

### Required zones: per-zone interval/grace, extra punishment, time windows (requested 2026-11-23, implement later)

- **Per-zone interval and grace period**, falling back to the rule-level values. Requested default: 5 minutes.
  - To clarify: 5 min fits the *grace period*; as an *interval* it is below today's minimum (15 min) and below the cron
    resolution (5 min), and would mean a manual check-in every 5 minutes – only realistic with background tracking.
  - Model change: today all required zones share **one** deadline ("check in at any of them"). Per-zone intervals mean each
    zone gets its own requirement and deadline ("be at Home every 4 h **and** at Work every 8 h"). State becomes
    `required.byZone: Record<zoneId, {lastValidAt, nextDeadline, missedCount, missedSinceValid}>`; "anywhere" (no zones)
    keeps the single deadline. Lock page action shows the earliest due deadline.
- **Per-zone extra punishment:** additional `onMissed` (and optionally `onSuccess`/`onOutside`) list per zone, applied on top of
  the rule's common lists.
- **Time windows per zone:** a zone is required only during one or more windows, e.g. `[{start:"08:00", end:"10:00"}, {start:"18:00", end:"20:00"}]`
  (lock timezone, may cross midnight; optionally weekdays).
  - **Decided (2026-11-23): "must stay inside"** – see *Curfew merged into zone time windows* below. The interval-based
    check-in stays as the separate, window-less part of the required rule.
- Proposed shape: `rules.required.zones: Record<zoneId, { intervalMinutes?, graceMinutes?, windows?: {start, end, days?}[], onMissed?, onSuccess? }>`.
- UI: each selected zone in the Required tab expands to interval, grace, time windows (add/remove rows) and extra punishment.
- Tests: independent deadlines per zone, fallback to rule defaults, window start/end incl. midnight crossing, missed at window end
  exactly once, extra list order, idempotency keys per zone and window.
- Related: *Zone roles* (only required zones listed) and *Forbidden per-zone settings* use the same per-zone expandable editor.

### Hunt: show all targets to the wearer (requested 2026-11-23, implement later)

Goal: an option that lets the wearer see **all** hunt checkpoints, and make that the default reveal.

- New reveal value `"all"` – label **"Hint + pin all on the map"** – next to the existing `hint`, `distance`, `map`
  (`map` stays as "Hint + pin current on the map").
- **Default** for `rules.hunt.reveal` changes from `"distance"` to `"all"`. Applies to new configurations only; saved configs
  contain their explicit value and keep their behaviour.
- Wearer view with `"all"`:
  - Every checkpoint is pinned on the map with its radius, numbered in order, and with its hint text.
  - Status per pin: ✓ found (grey), ▶ current (highlighted), upcoming (outlined). A list below the map mirrors this.
  - The distance band (hot/cold) is shown for the current checkpoint as in `distance`.
- **Order stays enforced** (same engine logic): only the *current* checkpoint can be found; walking through a later one does
  nothing. To decide: a separate option *"Any order"* where any unfound checkpoint counts – changes `hunt.index` to a
  `found: string[]` set in state, and `onComplete` fires when all are found. Proposal: out of scope for this item, note as follow-up.
- **Wrong guesses** keep working as today (manual "Submit hunt guess" outside the current checkpoint applies `onWrong`).
  With all targets visible, a keyholder may want *no* wrong-guess penalty – mention in the editor help.
- **Spec changes:** F6 reveal list gets `all`; **F6 AC3 changes** – "checkpoints after the current one are never sent to the wearer"
  holds for `hint`/`distance`/`map` only; with `all` the full list (coordinates, radius, hint, status) is sent on purpose.
  **Decision (2026-11-23): visible checkpoints are synced to OwnTracks** as waypoints, for reliable detection (the phone
  reports entering a checkpoint immediately instead of relying on sparse location reports):
  - `all` → all unfound checkpoints; `map` → only the current checkpoint; `hint` / `distance` → none (secret, as today).
  - Waypoint `desc` = `"Hunt <n>: <name>"` (distinct from zone names); `parseOwnTracks` maps such transitions to the checkpoint,
    and an *enter* of the current checkpoint completes it (same as a position inside it). Found checkpoints are removed with the
    next waypoint push (the waypoint hash includes hunt index and reveal mode).
  - iOS monitors max. 20 regions per app – guaranteed by the config limit of 20 zones + checkpoints in total (MAX_PLACES, implemented 2026-11-23), so all visible checkpoints always fit.
  - Checkpoints below ~100 m radius are less reliable as phone regions – location reports inside still count as before.
  - F14 AC9 changes to: "waypoints never contain checkpoints that are not visible to the wearer".
  - Tests: waypoints per reveal mode, re-push after a checkpoint is found, 20-region limit, transition → checkpoint found.
- `SessionView.hunt` gets `checkpoints?: {index, name, hint, lat, lng, radiusM, status: "found"|"current"|"upcoming"}[]` when reveal is `all`.
- UI: config page select gets the new option (first in the list, preselected for new configs); main page map renders all pins (Leaflet
  layer group, auto-fit to all checkpoints); demo config uses `all`.
- Tests: view contains all checkpoints with correct status for `all` and none beyond the current for the other modes; default
  value; finding a later checkpoint out of order does nothing; docs (rules, configuration, checking-in) updated.

### Curfew merged into zone time windows (change request 2026-11-23, specify now, implement later)

Decisions: windows are set **per zone**; for a required zone a window means **"must stay inside"** (old curfew behaviour).
The standalone *Curfew* rule (F15) is removed and replaced by time windows on required and forbidden zones.

**Shared window model**
- `Window = { start: "HH:MM", end: "HH:MM", days?: ("mon"|…|"sun")[] }` – lock timezone, may cross midnight
  (a window starting Fri 22:00 belongs to Friday, even after midnight); no `days` = every day. Up to 10 windows per zone.
- Helper `activeWindow(windows, at, tz)` in `time.ts` returns the window instance active at `at` (with its start as ISO,
  used for idempotency/cooldown keys) or `undefined`.

**Required zones** – `rules.required.zones[zoneId].stayWindows?: Window[]`, `onOutsideDuringWindow?: Consequence[]`
(falls back to rule-level `rules.required.onOutsideDuringWindow`), `windowCooldownMinutes?` (default 60, rule-level fallback).
- During an active window of zone Z, every accepted observation (tracked or manual) **outside Z** applies the consequences,
  at most once per cooldown and window instance. Hysteresis as for presence: "outside" means clearly outside
  (`distance − accuracy > radius`).
- Several required zones with overlapping windows: being inside **any** zone whose window is active satisfies all active
  windows (e.g. "Home or Partner's place 22:00–06:00"). Separate zones with separate windows are checked independently.
- No signal during a window is covered by the tracking heartbeat; optional later: "window start without fresh location" check.
- Window-less required zones keep the interval check-in behaviour (F2). A zone can have both an interval and stay windows.
- Requires `tracking.enabled` if any zone has stay windows (as curfew did) – validation error otherwise.

**Forbidden zones** – `rules.forbidden.zones[zoneId].windows?: Window[]`.
- No windows = forbidden all the time (today's behaviour). With windows the zone is forbidden **only** while a window is active,
  e.g. "Bar forbidden 20:00–02:00", "Casino always".
- Entry confirmation, cooldown and the trigger-on-leave logic apply as today, evaluated at observation time; a visit that
  started before the window counts from window start (duration inside the window).

**Removal of F15 and migration**
- `parseConfig` migrates old configs: `rules.curfew {enabled, zoneIds, start, end, cooldownMinutes, onOutside}` →
  for each curfew zone: add it to `rules.required.zoneIds` (if not there) with `stayWindows: [{start, end}]`,
  `onOutsideDuringWindow: onOutside`, `windowCooldownMinutes: cooldownMinutes`. A curfew zone that is also forbidden keeps its
  forbidden role and is reported as a migration warning instead.
  If the required rule was disabled, it is enabled with no interval check-ins for those zones ("stay windows only").
  → Needs a per-zone flag `intervalCheckins: boolean` (default true) so a migrated zone doesn't suddenly get interval deadlines.
- State: `curfew.lastTriggered` → `required.windowTriggered: Record<zoneId, ISO>`.
- Remove: curfew section in the Tracking tab, `CurfewRuleSchema`, `evalCurfew`, curfew lines in view/summary, Handlebars snippet.

**UI**
- Required tab, per selected zone (expandable, same editor as the other per-zone items): *Check-in interval* (on/off + values) and
  *Must stay inside during* (window rows: from, to, weekdays chips, add/remove) + consequences + cooldown.
- Forbidden tab, per selected zone: *Forbidden* `always` / `only during` + window rows.
- Map/zone list: zones with windows show a 🕑 badge; wearer page lists today's windows per zone ("Home: stay inside 22:00–06:00",
  "Bar: forbidden 20:00–02:00") and highlights an active one.

**Docs/spec updates when implemented:** F2/F3 get the window sections, F15 is marked *superseded*, user guide *Rules explained*
(curfew section → required/forbidden windows), configuration example "Stay home tonight" rewritten with a stay window, Handlebars description.

**Tests:** window active incl. midnight crossing and weekdays; required stay window outside → consequence with cooldown per window
instance; inside any active required zone → nothing; forbidden only during window, visit spanning window start; validation
(stay windows need tracking); migration of an old curfew config (incl. disabled required rule and curfew zone that is forbidden);
wearer view lists windows.

Builds on (implement together): *Required zones: per-zone interval/grace, extra punishment, time windows*, *Forbidden zones: per-zone
cooldown and extra punishment*, *Zone roles*.

### Warning before a missing-signal penalty (requested 2026-11-23, implement later)

- Option `tracking.warnBeforeMinutes?: number` (e.g. 30): when no location has arrived and the heartbeat deadline is that close,
  the wearer gets a warning ("No location from your phone for 2 h 30 min – open OwnTracks, otherwise +1 h in 30 min").
  At most one warning per heartbeat period.
- **Adjustable, but never later than the penalty** (decided 2026-11-23):
  - Keyholder sets the lead time; validation `10 ≤ warnBeforeMinutes < heartbeatMinutes`. The minimum of 10 min (two cron runs)
    guarantees that the warning is sent strictly before the penalty despite the 5-min cron resolution.
  - The warning is due at `nextHeartbeat − warnBeforeMinutes`; the cron sends it in the first run at or after that time
    **only while `now < nextHeartbeat`**. If a run is late and the deadline has already passed (e.g. cron outage), the warning is
    skipped instead of being sent together with or after the penalty.
  - Within one cron run the warning is always processed before the penalty check.
  - Editor shows the resulting time: "Warning after 2 h 30 min without signal, penalty after 3 h".
- Possibly the same mechanism for required check-in deadlines ("check-in due in 15 min").
- **Delivery channel – to decide.** The phone app itself can't be reached when it is silent (OwnTracks only receives commands
  in the response to its own messages), so the warning needs a separate channel:
  1. **ntfy** (recommended for the beta): the wearer installs the free ntfy app (iOS/Android) and subscribes to a random secret
     topic shown on the check-in page (QR/link, like the OwnTracks pairing). Worker sends `POST https://ntfy.sh/<topic>`.
     Simple, no accounts, no keys; topic name is the secret; self-hostable.
  2. **Web Push** from the GitHub Pages app (service worker + VAPID keys in the worker). No extra app, but iOS only delivers
     Web Push to web apps added to the home screen (iOS 16.4+), and it can't be set up inside Chaster's iframe.
  3. **Chaster custom log entry** as a fallback – visible in the lock history, but not a push notification.
- Privacy: only the warning text is sent, no location; topic/subscription deleted when the session ends.
- Tests: warning sent once at `nextHeartbeat − warnBeforeMinutes`, not sent if a location arrived, idempotent across cron runs,
  never sent at or after the deadline (late cron run → skipped), validation of the 10 min minimum and `< heartbeatMinutes`.

### Missing-signal default 20 min (changed 2026-11-23) – follow-up to verify

- `tracking.heartbeatMinutes` default 180 → **20**, minimum 30 → **15** (three cron runs). Implemented.
- Risk: a stationary phone in OwnTracks *Significant* mode (especially iOS) may not report for hours → frequent penalties.
  To verify on real devices; possible follow-ups: provision OwnTracks in *Move* mode (`monitoring: 2`) when the heartbeat
  is short, a heartbeat quiet-hours option, and the planned warning (min. lead time 10 min fits below 20 min).

### F17 – Reachability safety check for zones and checkpoints (requested 2026-11-23, implement later)

Goal: protect the wearer from being sent to places that are dangerous or impossible to reach. Every zone and hunt checkpoint
is checked when it is placed; each point flagged as *out of reach* must be **confirmed individually** by the keyholder as
intentional before the configuration can be saved.

**Checks** (run in the configuration page, debounced after add / move / radius change):

| Check | Data source (free, no key) | Flag when |
|---|---|---|
| Water (lakes, rivers, reservoirs) | OSM Overpass `is_in` → `natural=water`, `waterway=riverbank`, `water=*` | the zone is entirely in water |
| Sea / ocean | Nominatim reverse (`zoom=10`) returns no land result; OSM has no ocean polygons | centre is offshore |
| High mountains | Open-Meteo Elevation API (Copernicus DEM, ~90 m) | elevation > 2000 m (configurable later) |
| Glacier / cliff / bare rock | Overpass `natural=glacier\|cliff\|bare_rock` | the zone is entirely inside / centre on it |
| Restricted area | Overpass `landuse=military`, `aeroway=aerodrome\|runway`, `railway=rail` within radius | the zone is entirely inside a military area / airport, or the centre lies on a runway or rail track |
| No access | Overpass: no `highway=*` (road, path, track) within radius + 100 m | nothing walkable nearby |

- **"Entirely"** is tested with sample points: centre + 8 points at 0.7 × radius. A zone counts as *out of reach* only if all
  samples fail; if some fail, it gets an info note "partly in water" (no confirmation needed).
- Results are cached per (rounded lat/lng, radius) in `sessionStorage`; requests respect the usage policies
  (Nominatim ≤ 1 req/s with a proper User-Agent/Referer, Overpass fair use; one combined Overpass query per point).
- Privacy: only the keyholder's zone/checkpoint coordinates are sent to OSM/Open-Meteo services (address search already uses Nominatim),
  never wearer locations. Mentioned in the privacy page.

**Confirmation**
- Flagged points show ⚠ in the zone/checkpoint list and on the map with the reasons ("in a lake", "≈ 2450 m altitude").
- Each flagged point has its own checkbox **"I know – this place is intentionally hard to reach"**. No bulk confirm.
- Saving is blocked (and the Chaster save button gets `save_failed` with a message) while any flagged point is unconfirmed.
- The confirmation is stored in the config: `zone.reachabilityAck?: { reasons: string[], at: ISO }` (same for checkpoints).
  Moving the point or changing its radius re-runs the check; if the reasons change, the confirmation is cleared.
- If a check service is unreachable, the point is marked "could not be checked" – shown, but not blocking.
- The worker does not re-run the checks (keeps the free-tier subrequest budget); it only validates the shape of `reachabilityAck`.

**Wearer side (safety transparency)**
- Confirmed out-of-reach points are shown to the wearer with the reason (e.g. "⚠ This zone is in a lake – confirmed as intentional
  by the keyholder"), in the rule summary before accepting the lock and on the check-in page. Hidden hunt checkpoints show only
  a generic note ("one checkpoint is in difficult terrain") so the hunt stays secret.

**Tests:** sample-point logic (all / some / none failing), each check's parser with recorded API responses, confirmation required
per point, ack cleared when reasons change, save blocked, service failure → non-blocking, wearer view texts incl. hidden checkpoints.

**Docs:** user guide *Configuring a lock* (safety check section), *Privacy* (third-party lookups), FAQ ("why can't I save?").
