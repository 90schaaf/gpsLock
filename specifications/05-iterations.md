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

> **Status: implemented 2026-11-23** (config/state v2, worker v2, web UI).

- `Zone.matchMode?: "lenient" | "strict"` and `Checkpoint.matchMode?` override the lock-wide `matchMode`, which stays the default (existing configs unchanged).
- All `isInside` callers use `zone.matchMode ?? config.matchMode`; leaving a zone keeps the hysteresis rule (`distance − accuracy > radius`) regardless of mode.
- Config editor: *Lenient / Strict* selector per zone and checkpoint; adding a zone to the forbidden rule suggests *strict* unless the keyholder already chose a mode.
- Update docs (configuration, rules), zod schema, tests (per-zone override, fallback, forbidden default suggestion).

### Zone roles in the zone overview (requested 2026-11-23, implement later)

> **Status: implemented 2026-11-23** (config/state v2, worker v2, web UI).

- **Decided (2026-11-23):** a zone has roles from this set: **required and/or reward**, **or forbidden**, **or neutral**.
  - Allowed combinations: `required`, `reward`, `required + reward`, `forbidden`, `neutral` (no role).
  - `forbidden` excludes every other role; `neutral` means no role (zone is only shown on the map / used by travel display).
  - Shape: `Zone.roles: ("required" | "reward" | "forbidden")[]` (empty = neutral); validation rejects `forbidden` combined with anything.
- The zone list and the map show the roles (badge and colour per role; required + reward shows both badges).
- The *Required* tab lists only zones with role `required`, the *Reward* tab only `reward`, the *Forbidden* tab only `forbidden`.
  Selecting a zone in a rule tab is replaced by the role: a zone with role `required` **is** a required zone (no separate `zoneIds`).
- Changing a role in the Zones tab removes the zone's per-zone settings of the dropped role (with a confirm dialog if settings exist).
- Migration for existing configs: roles are derived from the rules that use the zone (`rules.X.zoneIds`); a zone in
  required + forbidden (already invalid today) is reported as a migration error.
- Curfew is merged into required-zone stay windows (see below), so it needs no own role.
- Could be combined with *Zone matching per zone* (the forbidden role suggests strict matching).

### Forbidden zones: per-zone cooldown and extra punishment (requested 2026-11-23, implement later)

> **Status: implemented 2026-11-23** (config/state v2, worker v2, web UI).

- **Per-zone escalation with warnings (decided 2026-11-23)** – replaces the single cooldown. Defaults, adjustable per zone:
  - `firstPenaltyAfterMinutes` = **10**: the first penalty applies after 10 min inside; `firstWarningAfterMinutes` = **2**:
    warning after 2 min inside ("You are in the forbidden zone *Bar* – leave within 8 min or: +1 h").
  - `repeatEveryMinutes` = **5**: while still inside, a further penalty every 5 min; `repeatWarningAfterMinutes` = **1**:
    warning 1 min after each penalty ("Still inside *Bar* – next penalty in 4 min").
  - Timeline: enter 0′ → ⚠ 2′ → ❌ 10′ → ⚠ 11′ → ❌ 15′ → ⚠ 16′ → ❌ 20′ … until the wearer has clearly left (hysteresis).
  - Leaving and re-entering within `repeatEveryMinutes` continues the current escalation instead of restarting at 0 (prevents
    "step out, step in" to reset the timer).
  - Validation: warnings strictly before the next penalty (`firstWarning < firstPenalty`, `repeatWarning < repeatEvery`);
    `repeatEveryMinutes ≥ 5`, `firstPenaltyAfterMinutes ≥ 1`.
  - **Needs background tracking** for the timeline. Without tracking (manual check-in inside a forbidden zone) the penalty
    applies immediately, as today, and repeats at most every `repeatEveryMinutes`.
  - Timing: evaluated on every incoming location **and** by the cron. The cron runs every 5 min today, so warnings at 1′/2′
    would be up to 5 min late → **cron must run every minute** (`* * * * *`, within the free tier) and only process sessions with
    an active escalation in that minute; the full sweep stays every 5 min. While inside, "still inside" is assumed as long as the
    last location inside is not older than `heartbeatMinutes`; afterwards the escalation pauses (the missing-signal rule takes over).
  - Warnings are delivered through the channel of *Warning before a missing-signal penalty* (see there) and are also written to
    the lock history.
  - `entryConfirmMinutes` (tracking tab) is no longer needed for forbidden zones – the 10-min first penalty replaces it.
- **Per-zone extra punishment:** each forbidden zone can have an additional consequence list that applies on top of the rule's
  common `onEnter` list (e.g. all forbidden zones +1 h, "Casino" additionally pillory 2 h).
- Proposed shape: `rules.forbidden.zones: Record<zoneId, { cooldownMinutes?: number; onEnter?: Consequence[] }>`; the rule-level
  `cooldownMinutes` stays as the default for zones without their own value (existing configs keep working, since saved configs
  contain their explicit value).
- UI: in the Forbidden tab, each selected zone expands to show its cooldown field and an "Extra punishment" consequence editor.
  Rule summary shown to the wearer lists per-zone cooldowns and extras.
- The editor shows the resulting timeline and what a 1-hour stay costs (e.g. "1 h inside = 11 penalties").
- **Repeat penalties – decided (2026-11-23):** by default every repeat applies the same consequences as the first penalty
  (common list + the zone's extra list). Each consequence entry can be scheduled individually:
  - `when: { every: true }` (default) – at every penalty;
  - `when: { everyNth: n }` – at every n-th penalty (e.g. pillory at the 3rd, 6th, 9th …);
  - `when: { nth: n }` – exactly once, at the n-th penalty (e.g. freeze at the 4th).
  - Shape: optional `when` on the consequence (`ConsequenceSchema` gains `when?`); the penalty counter per visit is kept in state
    (`forbidden.visits[zoneId] = {since, penalties}`) and reset when the wearer has clearly left (re-entry rule above).
  - Editor: a small "when" selector per consequence row (*every time / every n-th / only the n-th*), shown only in lists that repeat.
  - The same `when` option can later be reused for other repeating lists (missed heartbeat, missed required check-ins).
  - Tests: every / everyNth / nth over a 1-hour stay, counter reset after leaving, idempotency per penalty number.
- Tests: timeline with default values (warnings and penalties at 2/10/11/15/… min), per-zone values independent, re-entry continues
  the escalation, leaving stops it, no warning at/after a penalty time, manual check-in immediate penalty, extra list after the
  common list, idempotency keys per zone and escalation step, 1-min cron only touches sessions with active escalations.

### Required zones: per-zone interval/grace, extra punishment, time windows (requested 2026-11-23, implement later)

> **Status: implemented 2026-11-23** (config/state v2, worker v2, web UI).

- **Per-zone interval and grace period**, falling back to the rule-level values.
  - **Decided (2026-11-23): grace period default 5 min** (was 15); interval default stays 4 h (minimum 15 min).
  - **Decided (2026-11-23): each zone separately (AND).** Each required zone gets its own requirement and deadline
    ("be at Home every 4 h **and** at Work every 8 h"); a check-in at Home doesn't reset Work. State becomes
    `required.byZone: Record<zoneId, {lastValidAt, nextDeadline, missedCount, missedSinceValid}>`; "anywhere" (no zones)
    keeps the single deadline. Zones without own values use the rule defaults but still have their own deadline.
    Lock page action shows the earliest due deadline. Migration: existing configs with several required zones and one shared
    deadline ("any of them") get a per-rule option `combine: "any"` so their behaviour doesn't change; new configs use `"each"`.
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

> **Status: implemented 2026-11-23** (config/state v2, worker v2, web UI).

Goal: an option that lets the wearer see **all** hunt checkpoints, and make that the default reveal.

- New reveal value `"all"` – label **"Hint + pin all on the map"** – next to the existing `hint`, `distance`, `map`
  (`map` stays as "Hint + pin current on the map").
- **Default** for `rules.hunt.reveal` changes from `"distance"` to `"all"`. Applies to new configurations only; saved configs
  contain their explicit value and keep their behaviour.
- Wearer view with `"all"`:
  - Every checkpoint is pinned on the map with its radius, numbered in order, and with its hint text.
  - Status per pin: ✓ found (grey), ▶ current (highlighted), upcoming (outlined). A list below the map mirrors this.
  - The distance band (hot/cold) is shown for the current checkpoint as in `distance`.
- **Order – decided (2026-11-23): option per hunt** `rules.hunt.order: "sequence" | "any"` (default `"sequence"`).
  - `sequence`: as today – only the current checkpoint can be found; walking through a later one does nothing.
  - `any`: every unfound checkpoint counts; state changes from `hunt.index` to `hunt.found: string[]` (index kept as
    `found.length` for views); `onCheckpoint` per find, `onComplete` when all are found. Map status: found / open (no "current").
  - `any` is selectable with every reveal mode; with `hint`/`distance`/`map` the wearer sees the hints/pins of all open checkpoints
    (with `map`: all open pins), so in practice `any` pairs with `all`.
  - OwnTracks sync with `any`: all open checkpoints (visible ones only, as decided below).
- **Wrong guesses – decided (2026-11-23): disabled automatically with reveal `all`.** No "Submit hunt guess" button, no `onWrong`;
  the *wrong-guess* fields are hidden in the editor while `all` is selected (kept in the config for other modes).
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

> **Status: implemented 2026-11-23** (config/state v2, worker v2, web UI).

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

> **Status: implemented 2026-11-23** (config/state v2, worker v2, web UI).

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
- **Delivery channel – decided (2026-11-23): ntfy.** (OwnTracks can't be reached while silent – it only receives commands in the
  response to its own messages.)
  - The wearer installs the free **ntfy** app (iOS/Android) and taps *Set up warnings* on the check-in page: the worker creates a
    random secret topic (`lockation-<32 random chars>`) and shows a subscribe link `ntfy://ntfy.sh/<topic>` + QR code, like the
    OwnTracks pairing. KV `NTFY:<sessionId>` → topic; deleted with the session (delete webhook) or via *Stop warnings*.
  - Worker sends `POST https://ntfy.sh/<topic>` with title, message, priority (`high` for "penalty in < 5 min") and a click URL to
    the check-in page. Base URL configurable (`NTFY_BASE`, default `https://ntfy.sh`) for a self-hosted server.
  - Every warning is also written to the Chaster lock history (custom log), so it's visible even without ntfy.
  - Used by: missing-signal warning, forbidden-zone escalation warnings; later possibly required check-in deadlines.
  - Web Push is not implemented (iOS only for home-screen web apps, not inside Chaster's iframe).
  - Free-tier budget: one ntfy request = one Worker subrequest; the 1-min cron batches warnings per run.
- Privacy – decided (2026-11-23): the push text may contain **zone names and the consequence** ("You are in the forbidden zone
  *Bar* – leave within 8 min or +1 h"), **never coordinates**. Hidden hunt checkpoints are never named. ntfy.sh can read the text
  (TLS only, no end-to-end encryption) – stated in the privacy page; a self-hosted ntfy (`NTFY_BASE`) avoids that.
  Topic/subscription is deleted when the session ends.
- Tests: warning sent once at `nextHeartbeat − warnBeforeMinutes`, not sent if a location arrived, idempotent across cron runs,
  never sent at or after the deadline (late cron run → skipped), validation of the 10 min minimum and `< heartbeatMinutes`.

### Missing-signal default 20 min (changed 2026-11-23) – follow-up to verify

- `tracking.heartbeatMinutes` default 180 → **20**, minimum 30 → **15** (three cron runs). Implemented.
- Risk: a stationary phone in OwnTracks *Significant* mode (especially iOS) may not report for hours → frequent penalties.
  To verify on real devices; mitigations: Move mode (below), the planned warning, and quiet hours:
- **Missing-signal quiet hours – decided (2026-11-23): optional.** `tracking.quietHours?: {start, end}` (lock timezone, may cross
  midnight; not set by default). No missing-signal penalty is due during quiet hours; a deadline that falls inside moves to the end
  of quiet hours + one full `heartbeatMinutes` period (so the phone has time to report after waking). No warnings during quiet hours.
  Forbidden zones, stay windows and all other rules keep working at night on the locations that do arrive.
  Tests: deadline inside quiet hours moved, midnight crossing, no warning inside, normal behaviour outside.
- **OwnTracks mode – decided (2026-11-23): keyholder chooses**, setting `tracking.owntracksMode: "auto" | "move" | "significant"`
  in the Tracking tab, default **`auto`**:
  - `auto` → pairing provisions **Move** mode (`monitoring: 2`, frequent reports, more battery) if `heartbeatMinutes < 60` **or**
    forbidden zones are enabled; otherwise battery-saving **Significant** mode (`monitoring: 1`).
  - `move` / `significant` force the mode.
  - The editor shows which mode `auto` currently results in and its battery impact; the check-in page tells the wearer which mode
    to keep. Changing the setting (or the inputs of `auto`) during a lock: the next waypoint push also sends a
    `setConfiguration` command with the new `monitoring` value, so the wearer doesn't have to pair again.
  - Tests: auto → move/significant for each input combination, provisioning link contains the right `monitoring`, config change
    triggers a `setConfiguration` push once.

### F17 – Reachability safety check for zones and checkpoints (requested 2026-11-23, implement later)

> **Status: implemented 2026-11-23** (config/state v2, worker v2, web UI).

Goal: protect the wearer from being sent to places that are dangerous or impossible to reach. Every zone and hunt checkpoint
is checked when it is placed; each point flagged as *out of reach* must be **confirmed individually** by the keyholder as
intentional before the configuration can be saved.

**Checks** (run in the configuration page, debounced after add / move / radius change):

| Check | Data source (free, no key) | Flag when |
|---|---|---|
| Water (lakes, rivers, reservoirs) | OSM Overpass `is_in` → `natural=water`, `waterway=riverbank`, `water=*` | the zone is entirely in water |
| Sea / ocean | Nominatim reverse (`zoom=10`) returns no land result; OSM has no ocean polygons | centre is offshore |
| Glacier / cliff / bare rock | Overpass `natural=glacier\|cliff\|bare_rock` | the zone is entirely inside / centre on it |
| Restricted area | Overpass `landuse=military`, `aeroway=aerodrome\|runway`, `railway=rail` within radius | the zone is entirely inside a military area / airport, or the centre lies on a runway or rail track |
| No access | Overpass: no `highway=*` (road, path, track) within radius + 100 m | nothing walkable nearby |

- **"Entirely"** is tested with sample points: centre + 8 points at 0.7 × radius. A zone counts as *out of reach* only if all
  samples fail; if some fail, it gets an info note "partly in water" (no confirmation needed).
- Results are cached per (rounded lat/lng, radius) in `sessionStorage`; requests respect the usage policies
  (Nominatim ≤ 1 req/s with a proper User-Agent/Referer, Overpass fair use; one combined Overpass query per point).
- **No altitude limit (decided 2026-11-23):** there is no elevation check – high places are not flagged by altitude; dangerous mountain
  terrain is still covered by the glacier / cliff / bare rock check. No Open-Meteo dependency.
- Privacy: only the keyholder's zone/checkpoint coordinates are sent to OSM services (address search already uses Nominatim),
  never wearer locations. Mentioned in the privacy page.

**Confirmation**
- Flagged points show ⚠ in the zone/checkpoint list and on the map with the reasons ("in a lake", "on a glacier").
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

### Confirmed behaviour (2026-11-23)

- **Recovery after a missed required check-in applies to all tracked locks** (not only live-tracking-only): the first valid
  background location back in a required zone applies `onSuccess` once. With per-zone required deadlines this applies per zone.
  Already implemented (F14/F16); keep when reworking the required rule.

### Minor points – confirmed 2026-11-23

| # | Point | Proposed default |
|---|---|---|
| 1 | Radius below 100 m for zones | **Minimum lowered to 20 m (implemented)**; zones below 100 m show a hint in the editor. Hunt checkpoints: no hint. |
| 2 | Required per zone: which extra lists per zone | `onMissed` and `onSuccess` per zone; `onOutside` stays rule-level only. |
| 3 | Required per zone: manual check-in outside all required zones | `onOutside` applies once per check-in (not once per zone). |
| 4 | Missing-signal warning lead time default | 10 min (= minimum) when the option is enabled; option off by default. |
| 5 | Warnings for required check-in deadlines | Yes, same mechanism: optional "warn N min before a required deadline", off by default. |
| 6 | Keyholder notifications | **In the beta** – see *Keyholder notifications* below. |
| 7 | Forbidden-zone warnings optional | Each warning time can be set to *off*; penalties still follow the timeline. |
| 8 | Forbidden-zone windows + escalation | A visit already inside at window start starts its timeline at window start. |
| 9 | Verification pictures in live-tracking-only mode | Optional "random verification picture every N hours" (cron-based), off by default. |
| 10 | Hunt `any` order + time limit | Time limit unchanged (applies to the whole hunt). |
| 11 | i18n | English only for the beta (unchanged). |

### Keyholder notifications (decided 2026-11-23: part of the beta)

> **Status: implemented 2026-11-23** (config/state v2, worker v2, web UI).

- The keyholder can subscribe to push notifications via **ntfy**, like the wearer's warnings: *Set up notifications* on the
  keyholder view of the main page → worker creates a separate secret topic (`KV NTFY_KH:<sessionId>`), subscribe link + QR code;
  *Stop notifications* deletes it; the delete webhook removes it with the session.
- Events, each switchable by the keyholder (defaults in brackets):
  - penalty applied (any rule) [on] – "Bar: +1 h (forbidden zone, 2nd penalty)"
  - forbidden zone entered [on] – at the first warning time, so the keyholder knows before the first penalty
  - missing signal / tracking stopped / tracking set up [on]
  - required check-in missed [on], required check-in done [off]
  - hunt checkpoint found / hunt completed / hunt failed [on]
  - reward earned [off]
  - verification picture requested [on]
- Text rules as for wearer warnings: zone names and consequences, never coordinates (even with `privacy: exact` – the keyholder
  sees exact positions only in the app, not in third-party push). Hunt checkpoints may be named for the keyholder.
- Rate limit: at most 1 notification per event type and zone per 5 min; bursts in one evaluation are combined into one message.
- Self-locks: wearer and keyholder are the same person → only the wearer setup is offered.
- Tests: subscribe/unsubscribe, per-event switches, combined messages, rate limit, no coordinates in any text, topic removed on delete webhook.
- Implement together with the wearer warnings (shared ntfy client, topics, KV cleanup).

### Storage: move from KV to Cloudflare D1 (decided 2026-11-23, beta)

> **Status: implemented 2026-11-23** (config/state v2, worker v2, web UI).

- Reason: Workers KV on the free tier allows ~1,000 writes/day; the 5-min cron cursor alone uses ~290, the planned 1-min timer
  would add ~1,440. D1 (SQLite) free tier allows ~100k row writes/day (verify current limits in the Cloudflare dashboard).
- Tables (proposal): `history(session_id, id, at, record_json)` (last 200 per session), `devices(username, session_id, hash)`,
  `ntfy_topics(session_id, role, topic)`, `escalations(session_id, zone_id, since, penalties, next_at)` (indexed by `next_at`
  so the 1-min cron selects only due rows), `cron_state(key, value)`.
- Engine state stays in Chaster session data (`data.lockation`) as today.
- Migration: no production data yet → new binding `DB`, schema in `apps/worker/migrations/0001_init.sql`
  (`wrangler d1 migrations apply`); KV binding removed afterwards. Setup docs (`wrangler d1 create lockation`) updated.
- Tests: in-memory SQLite (e.g. `better-sqlite3` or Miniflare D1) replacing `MemoryKV`; history trimming, device lookup,
  due-escalation query, cleanup on session delete.

### ntfy with an account token (decided 2026-11-23, beta)

> **Status: implemented 2026-11-23** (config/state v2, worker v2, web UI).

- ntfy.sh limits anonymous senders per IP and Cloudflare Workers share IPs → the Worker authenticates with an access token of a
  (free) ntfy.sh account: secret `NTFY_TOKEN` (`wrangler secret put NTFY_TOKEN`), header `Authorization: Bearer <token>`.
  Without the secret, notifications are disabled and the UI hides the setup buttons.
- Topics stay random per session; the account only authenticates the sender. Upgrade to a paid plan if limits are reached.

### Operator contact (decided 2026-11-23)

- Privacy page and disclaimer name **GitHub issues** as the contact: `https://github.com/90schaaf/lockation/issues`
  ("Questions, data deletion requests and bug reports"). No personal data published.
- Note in the privacy page: deletion of stored data happens automatically when the lock ends; earlier deletion on request via
  an issue (without posting personal data publicly – a maintainer will reply). Some privacy laws may require more operator
  details – to revisit before a public (non-beta) release.

### Reward zones per zone (decided 2026-11-23)

> **Status: implemented 2026-11-23** (config/state v2, worker v2, web UI).

- Per reward zone, falling back to the rule values: `cooldownMinutes`, `maxPerDay`, `dwellMinutes` (minimum stay) and an extra
  reward list on top of the common `onEnter` (`when` scheduling as for forbidden repeats is not needed).
- Shape: `rules.reward.zones: Record<zoneId, { cooldownMinutes?, maxPerDay?, dwellMinutes?, onEnter? }>`; daily count per zone
  (`reward.countToday` becomes per zone; rule-level `maxPerDay` stays as an overall cap across all reward zones).
- Same expandable per-zone editor as required/forbidden. Tests: per-zone limits independent, overall cap, fallback, dwell per zone.

### Configuration changes during a running lock (decided 2026-11-23, beta)

> **Status: implemented 2026-11-23** (config/state v2, worker v2, web UI).

- Changes apply immediately (as today), but Lockation makes them visible to the wearer:
  - The worker compares the old and new configuration on save (`configSave` with a running session) and writes a summary to the
    lock history, e.g. "Lockation rules changed: forbidden zone *Casino* added; *Home* check-in interval 4 h → 2 h".
  - The wearer gets an ntfy notification with the same summary (if warnings are set up).
  - The wearer's check-in page shows "Rules changed <time>" with the summary until the wearer opens it once.
- Diff helper `diffConfig(old, new): string[]` in `packages/core` (zones added/removed/moved/resized, role changes, rule
  enable/disable, timing values, consequence lists changed – consequences summarised, not listed in full).
- Hidden hunt checkpoints are never described in the summary ("hunt checkpoints changed").
- Tests: diff texts for each change type, no output for identical configs, hidden checkpoints not revealed, log + notification on save.

### Beta release plan (decided 2026-11-23)

- **Beta testing with real locks starts after all beta items are built.** Until then: development on `feature/*` branches, the
  deployed version is a preview only (demo + docs), no testers invited.
- Beta scope (build order):
  1. Zone roles + per-zone settings (required incl. stay windows, forbidden escalation incl. repeat scheduling, reward),
     curfew merge with migration, per-zone matching, config `version: 2` migration.
  2. Storage on D1; ntfy client with token; wearer warnings, keyholder notifications, change notifications; 1-min timer;
     OwnTracks mode setting; missing-signal quiet hours; optional warnings before required deadlines.
  3. Hunt: reveal `all`, order option, wrong guesses off with `all`, checkpoint sync to OwnTracks.
  4. Reachability safety check (F17).
  5. Optional random verification pictures in live-tracking-only mode.
- Before inviting testers: Chaster developer portal set up (slug `lockation`), end-to-end test with a test lock, OwnTracks test
  on a real iPhone and Android phone, disclaimer/privacy reviewed.

### Improvements 2026-11-24 (implemented)

- **Tracking setup confirmed by a manual send:** status *connected* only after the first OwnTracks location with trigger
  `t: "u"` (user tapped publish) since pairing (`state.tracking.verifiedAt`). Automatic locations are evaluated meanwhile
  (`view.tracking.receiving`); the setup panel polls every 5 s and shows "Setup complete".
- **Test notification:** the setup sends "✅ Lockation test notification"; `POST /api/notify/test` sends another one.
- **Reachability:** one confirmation for all flagged places (stored per place as `reachabilityAck` as before).
- **Settings file:** export / import of the whole configuration (JSON, validated, disclaimer kept).
- **Hunt control:** `rules.hunt.start: auto | wearer | keyholder | scheduled` (`startAt` or `startAfterMinutes`),
  `pauseBy: nobody | keyholder | both`, `wearerCanAbort` + `onAbort`. State `hunt.status` gains `not_started | paused |
  aborted`, `pausedAt`, `pausedMs` (extends the time limit). Keyholder can always force-start and end without consequences;
  wearer abort = failed + `onAbort`. Self-locks: the wearer acts as wearer but may always start. `POST /api/hunt {action}`.
  Checkpoints are hidden and don't count before the start or while paused; scheduled starts are run by the cron.

### Changes 2026-11-24 (implemented)

- **Check-in mode** `tracking.checkins: manual | both | auto` replaces `countsAsCheckin` and `liveOnly` (migrated: liveOnly → auto,
  countsAsCheckin false → manual, else both). UI: one selector "How is the location collected?" – manual only (tracking off),
  manual + background, background only; `manual` with tracking on is only shown for older settings.
- **Required interval minimum:** 3 min when background locations count, 5 min with manual check-ins; OwnTracks report interval
  = half the shortest interval, 120–300 s (setConfiguration pushes `monitoring` + `locatorInterval`).
- **Zone actions:** `zone.actions {onEnter, onLeave, minStayMinutes, cooldownMinutes}` for every zone (any role, neutral
  too). Enter = presence starts; leave = clearly outside (hysteresis) with a stay ≥ minStay; stable idempotency keys per visit.
