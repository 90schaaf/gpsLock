# Changelog

## 2026-11-25

- **Toy test page (F27, step 1):** `toys.html` – toy list (type, body part, limits), generated Lockation XToys script, tests
  per toy / channel (patterns, intensity, ±10 %, shock, stop), test all, stop all, "which toys does XToys see" (WebSocket
  `getToys`), toy setup export / import; Webhook ID stays in the browser. Core: `packages/core/src/toys.ts`.
- **Toy control via XToys (F27) specified** (not implemented): Lockation proxy script (one webhook, toy + channel in the
  body), toy types with channels (e-stim 2, vibrator 1, dual vibrator 2, vibrator + rotator 2) and body parts, per-toy
  limits, toy test page and demo panel, consequence type `toy` incl. intensity changes, "while inside" with dead-man's
  switch, emergency stop with punishment and reconnect, toy disclaimer, no manual control during a lock, no automatic
  pause; liveness check on hold.
- **Surprise zones (F26):** zone role `surprise` – visible zones whose outcome is drawn by weight on entering (reward,
  punishment, or a hold: stay for a while / until the keyholder releases, at the latest after `holdMinutes`); once or every
  visit; early leave consequences; map marks new / visited / used / holding; `/api/surprise` release.
- **Surprise missions (F25):** `rules.mission` – random (every n min ±50 %, within active hours) or sent by the keyholder:
  reach a non-forbidden zone within `leadMinutes`; `onSuccess` / `onFail`, reminder, penalty-free declines per day,
  keyholder cancel. `state.mission`, `/api/mission`, keyholder notification switch `mission`, Missions tab, mission card.
- **Random hunt route:** `rules.hunt.random {enabled, min, max}` – at the start (or first evaluation of a running hunt) N ∈ [min, max]
  checkpoints are drawn from the pool in random order (`state.hunt.route`); everything (counts, hints, map, OwnTracks sync,
  order sequence/any) uses the route. Validation: min ≤ max ≤ pool size. Makes hunts possible on self-locks.
- **ntfy errors explained:** status, ntfy error text and a hint; the token is trimmed.

Condensed history of the specification and the implemented behaviour, newest first. Feature IDs refer to
[03-features.md](03-features.md).

## 2026-11-24

**Decisions (spec updated, implementation in progress)**
- v1 compatibility removed: no `migrateConfig` from v1, no v1 state migration; stored configs must be version 2.
- `tracking.checkins` is `both | auto`; manual-only = tracking disabled. The legacy `manual` mode and the old
  `countsAsCheckin` / `liveOnly` fields are gone.
- `rules.required.combine` removed: each required zone always has its own deadline (no shared "any of them" deadline).
- Scheduled hunt start time is interpreted in the lock's timezone.
- Shared application service in `packages/core` with ports for Chaster calls, storage and notifications, used by the
  worker and the demo backend.
- `/health` returns `{ok, version, commit}`.
- Spec set cleaned up: current-state spec, `05-iterations.md` replaced by `05-roadmap.md`, this changelog.

**Implemented**
- Demo: map clicks can send fake background locations (toggle in the demo bar); a click inside a zone is a normal map click
  where zones aren't selectable (F13).
- UI: checkboxes sized to their text, demo bar buttons the same height, Import / Export as its own tab.
- Check-in mode selector "How is the location collected?" (`checkins: manual | both | auto` replacing `countsAsCheckin` /
  `liveOnly`) (F14).
- Required interval minimum 3 min when background locations count, 5 min with manual check-ins; OwnTracks report interval
  = half the shortest interval, 120–300 s, pushed with `setConfiguration` (F2, F14). "Check in anywhere" explained.
- Zone actions on enter / leave with minimum stay and cooldown, for every zone incl. neutral (F21).
- Hunt control: start `auto | wearer | keyholder | scheduled`, `pauseBy`, keyholder force-start and penalty-free end,
  wearer give-up with `onAbort`; statuses `not_started | paused | aborted`; `POST /api/hunt` (F6).
- Tracking setup confirmed by a manual send (OwnTracks trigger `u`, `verifiedAt`); setup panel polls and shows "Setup
  complete" (F14).
- Test notification on setup and `POST /api/notify/test` (F22).
- Reachability: one confirmation for all flagged places (F17).
- Settings export / import (F24).
- Config page: inline validation next to the fields instead of a list on top (F11).
- Tracking card: live countdown to the next expected location and delay counter (F14).
- OwnTracks iPhone setup: *Allow external configuration* explained in the setup panel, guide, FAQ and README.
- Disclaimer shown only on the Zones tab until accepted; adding places requires it (F18).
- iframe-resizer child script so Chaster grows the iframe to the page height (F19).
- D1 database id added to `wrangler.toml`.

## 2026-11-23

**Configuration v2 and worker v2** (implemented)
- Zone roles (`required` and/or `reward`, or `forbidden`, or neutral) replacing per-rule zone lists; per-zone match mode
  (F1).
- Required: one deadline per zone, optional "anywhere" deadline, grace default 15 → 5 min, optional warning before
  deadlines, per-zone extra lists (F2).
- Curfew (F15) removed and merged into per-zone time windows: "must stay inside" windows on required zones, forbidden-only-
  during windows on forbidden zones, with weekdays.
- Forbidden: escalation timeline 2 / 10 / 5 / 1 min with per-zone overrides, re-entry continues the visit, `when`
  scheduling (`every | everyNth | nth`), also for missed and missing-signal lists; `entryConfirmMinutes` dropped (F3, F7).
- Reward: per-zone cooldown, daily cap, minimum stay and extra reward; rule cap is overall (F4).
- Hunt: reveal `all` (new default, no wrong guesses), order `sequence | any`, visible checkpoints synced to OwnTracks (F6).
- Tracking: missing-signal default 180 → 20 min (minimum 15), OwnTracks mode `auto | move | significant` with
  `setConfiguration`, missing-signal quiet hours and warning (F14).
- Notifications via ntfy (account token `NTFY_TOKEN`) for the wearer and the keyholder with switchable events (F22).
- Configuration changes during a lock: diff, log entry, notification, notice until acknowledged (F23).
- Random verification pictures for live-only locks (F8).
- Reachability safety check (water, sea, glacier / cliff, restricted areas, no access); altitude check dropped (F17).
- Storage moved from KV to D1; cron every minute for due sessions plus a full sweep every 5th minute.

**Earlier the same day**
- Mobile layout (max. 618 px), live position on the map, last reported position, real tracking status
  (`not_set_up | waiting | connected | no_signal`), access control to wearer / keyholder incl. configuration endpoints;
  lock history keeps zone names (F19).
- Minimum zone radius 50 → 20 m with a hint below 100 m; at most 20 zones + checkpoints (F1).
- Operator contact via GitHub issues; beta release plan.
- Disclaimer page and keyholder confirmation (F18); MIT licence.
- Live tracking only (F16) and background tracking with OwnTracks (F14), curfew (F15).
- Project renamed from GPS Lock to Lockation.
- Initial beta: rule engine, worker, web app, docs (F1–F13).
