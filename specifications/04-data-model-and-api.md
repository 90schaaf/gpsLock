# 04 – Data Model and Worker API (current state)

The zod schemas in `packages/core/src/config.ts`, `state.ts`, `consequences.ts` and the types in `engine.ts` / `view.ts`
are the source of truth; this document describes their shape. Defaults are in brackets. Only version 2 exists: there is no
v1 config or state migration.

## LockationConfig (Chaster extension `config`)

```ts
{
  version: 2,
  timezone: "Europe/Zurich",                 // IANA; all times of day are in this zone
  matchMode: "lenient" | "strict",           // [lenient], overridable per zone / checkpoint
  zones: Zone[],                              // zones + hunt checkpoints ≤ 20 (MAX_PLACES)
  rules: {
    required:  { enabled, anywhere [false], intervalMinutes [240], graceMinutes [5], quietHours?: {start, end},
                 warnBeforeMinutes?, onSuccess, onOutside, onMissed, onOutsideDuringWindow, windowCooldownMinutes [60] },
    forbidden: { enabled, firstWarningAfterMinutes [2 | null], firstPenaltyAfterMinutes [10],
                 repeatEveryMinutes [5, ≥ 5], repeatWarningAfterMinutes [1 | null], onEnter },
    reward:    { enabled, cooldownMinutes [720], maxPerDay [1, overall], dwellMinutes [0], onEnter },
    travel:    { enabled, stepKm [1], maxKmPerCheckin [50], dailyCapKm [100], onStep },
    hunt:      { enabled, checkpoints: Checkpoint[], reveal ["all" | "hint" | "distance" | "map"],
                 order ["sequence" | "any"], wrongCooldownMinutes [10], timeLimitMinutes?, blockUnlockUntilComplete [false],
                 start ["auto" | "wearer" | "keyholder" | "scheduled"],
                 startAt?,                    // ISO instant (UTC); the config page enters it in the lock timezone
                 startAfterMinutes?, pauseBy ["keyholder" | "nobody" | "both"], wearerCanAbort [false],
                 onAbort, onCheckpoint, onWrong, onComplete, onTimeout }
  },
  tracking: { enabled [false], checkins ["both" | "auto"], heartbeatMinutes [20, ≥ 15], onHeartbeatMissed,
              maxDelayMinutes [1440], owntracksMode ["auto" | "move" | "significant"], quietHours?,
              warnBeforeMinutes? /* 10 ≤ N < heartbeatMinutes */ },
  antiCheat: { maxAccuracyM [100], maxFixAgeSeconds [120], maxSpeedKmh [200],
               onImplausible ["reject" | "reject_and_penalize" | "accept_and_verify"], implausibleConsequences,
               verificationPicture ["never" | "always" | "random"], verificationProbability [0.2],
               minIntervalSeconds [60], liveVerificationEveryHours? /* needs checkins "auto" */ },
  privacy: { coordinates: "zone_only" | "exact" },  // [zone_only]
  notifications: { keyholder: { penalty [on], forbiddenEntered [on], tracking [on], requiredMissed [on],
                                requiredDone [off], hunt [on], reward [off], verification [on] } },
  disclaimer?: { version, acceptedAt }       // required on save (≥ DISCLAIMER_VERSION), optional on read
}

Zone = {
  id, name, lat, lng, radiusM /* 20 … 50 000 */,
  roles: ("required" | "reward" | "forbidden")[],   // [] = neutral; forbidden excludes others
  matchMode?,
  required: { intervalCheckins [true], intervalMinutes?, graceMinutes?, stayWindows: Window[],
              onMissed, onSuccess, onOutsideDuringWindow },          // extras on top of the rule lists
  forbidden: { windows: Window[] /* [] = always */, firstWarningAfterMinutes?, firstPenaltyAfterMinutes?,
               repeatEveryMinutes?, repeatWarningAfterMinutes?, onEnter },
  reward: { cooldownMinutes?, maxPerDay?, dwellMinutes?, onEnter },
  actions: { onEnter, onLeave, minStayMinutes [0], cooldownMinutes [0] },
  reachabilityAck?: { reasons: string[], at }
}
Checkpoint = { id, name, lat, lng, radiusM, hint, matchMode?, reachabilityAck? }
Window     = { start: "HH:MM", end: "HH:MM", days?: ("mon" | … | "sun")[] }   // ≤ 10 per zone, may cross midnight
Consequence = ({type: "add_time" | "remove_time", seconds} | {type: "freeze", durationMinutes?} | {type: "unfreeze"}
              | {type: "pillory", durationMinutes, reason} | {type: "log", message}
              | {type: "task", task, points, verificationRequired, durationMinutes?} | {type: "verification_picture"}
              | {type: "command", commandId, input, label?})
              & { when?: {every: true} | {everyNth: n} | {nth: n} }
```

Main validation rules: roles (no duplicates, `forbidden` alone); an enabled rule needs zones of its role (required:
or `anywhere`); warnings before penalties; required interval ≥ 3 min when background locations count, else ≥ 5 min;
`warnBeforeMinutes` shorter than the interval / heartbeat; stay windows need tracking; scheduled hunt needs `startAt` or
`startAfterMinutes`; hunt with checkpoints; unique ids; valid timezone.

## LockationState (Chaster session `data.lockation`)

```ts
{
  v: 2,
  startedAt, lastAttemptAt?,
  lastAccepted?: { lat, lng, accuracy, at },          // rounded to 3 decimals in zone-only mode
  privacyOverride?: "zone_only",
  required: { slots: Record<"*" | zoneId, { lastValidAt?, nextDeadline?, missedCount, missedSinceValid?, warnedFor? }>,
              windowLastTriggered? },
  forbidden: { visits: Record<zoneId, { since, lastInside, leftAt?, penalties, lastPenaltyAt?, warnedStep }> },
  reward: { lastTriggered: Record<zoneId, ISO>, day, countToday, countByZone: Record<zoneId, number> },
  travel: { pendingKm, totalKm, day, kmToday },
  hunt: { index, found: string[], status: "not_started" | "active" | "paused" | "completed" | "failed" | "aborted",
          startedAt?, pausedAt?, pausedMs, lastWrongAt?, lastDistanceBand? },
  zoneActions: Record<zoneId, { lastEnter?, lastLeave? }>,
  presence: Record<zoneId, { since, lastSeen }>,
  tracking: { deviceUser?, pairedAt?, verifiedAt?, lastSeenAt?, nextHeartbeat?, missedCount, warnedFor?,
              waypointsHash?, trackedCount, monitoring?, locatorInterval? },
  nextLiveVerification?,
  rulesChanged?: { at, summary: string[] },
  freezeUntil?,
  checkinCount, acceptedCount
}
```

Slots are synced to the config on every load (new required zones get a deadline from now, removed ones are dropped).
Missing or corrupt state is replaced by a fresh initial state.

## CheckinRecord (D1 `history`)

```ts
{ id, at, outcome: "accepted" | "rejected",
  reason?: "rate_limited" | "stale_fix" | "future_fix" | "poor_accuracy" | "implausible_speed" | "out_of_order" | "manual_disabled",
  accuracy, lat?, lng? /* only with exact sharing */, purpose: "general" | "hunt", source?: "manual" | "tracked",
  zones: string[], events: string[], flagged?: "implausible_speed",
  consequences: { type, source, description, ok?, error? }[] }
```

## SessionView (highlights)

| Field | Content |
|---|---|
| `role`, `isSelfLock`, `timezone`, `privacy`, `privacyLocked`, `matchMode`, `maxAccuracyM` | basics |
| `liveOnly` | tracking on with `checkins: "auto"` (no manual check-ins) |
| `zones[]` | `{id, name, lat, lng, radiusM, kinds, windows, windowActive, reachabilityNote?}` |
| `rules[]` | rule summary for the wearer (`{rule, title, lines}`) |
| `required`, `requiredSlots[]` | earliest deadline; per slot `{key, name, nextDeadline, overdue, missedCount, lastValidAt, graceMinutes}` |
| `forbiddenVisits[]` | `{zone, since, penalties, nextPenaltyAt}` |
| `hunt` | `status`, `actions` (allowed for the viewer), `start`, `scheduledStartAt`, `index`/`total`, `reveal`, `order`, `hint`, `distanceBand`, `target`, `checkpoints[]` (visible only), `openHints`, `guessesAllowed`, `terrainNote`, `deadline` |
| `tracking` | `paired`, `status`, `receiving`, `pairedAt`, `lastSeenAt`, `signalDueAt`, `nextHeartbeat`, `overdue`, `missedCount`, `heartbeatMinutes`, `mode`, `updates` |
| `lastPosition` | wearer always (approximate in zone-only mode); keyholder only with exact sharing |
| `presentZones`, `travel`, `freezeUntil`, `rulesChanged`, `notifications {available, subscribed}`, `stats`, `history` | |

## Toy control (F27)

- Config: `rules.toy {enabled, onEmergencyStop: Consequence[]}`, consequence `{type: "toy", action: "play" | "intensity" |
  "shock" | "stop", target: {bodyPart: "genitals" | "anal" | "nipples" | "other" | "all", toyType?, channel?}, shape?:
  "constant" | "pulse" | "wave" | "ramp", intensity?, delta?, seconds?, keep?: {until: "leave" | "return" | "released" |
  "time", minutes?}}` (`keep` only with `play`).
- Toy: `{id, name, type: "estim" | "vibrator" | "dual_vibrator" | "vibe_rotator" | "rotator", bodyPart}` (limits are set in XToys); channels per type: estim `A, B` · vibrator `main` · dual_vibrator `A, B` ·
  vibe_rotator `vibration, rotation` · rotator `main`.
- State: `toy {connectedAt?, verifiedAt?, disclaimerVersion?, toys: Toy[], kept: {[id]: {label, target, shape, level, until,
  zoneIds, holdSince?, startedAt, endsAt?}}, running: {[toyId:channel]: {source, label, shape, level, sentAt, refreshAt,
  resumeAt?}}, emergencyStops}` – the Webhook ID is **not** in the state.
- D1 `toys`: `session_id` (PK), `webhook_id`, `created_at` – deleted on disconnect and on session end.
- API: `/api/toy/connect {mainToken, webhookId, toys, disclaimerVersion}` (wearer), `/api/toy/test {mainToken}`,
  `/api/toy/confirm {mainToken}`, `/api/toy/emergency-stop {mainToken}` (wearer; applies `onEmergencyStop`). The toy test page talks to XToys directly (no worker endpoint).

## Worker HTTP API

All `/api/*` endpoints: `POST`, JSON, CORS restricted. Errors: `{error: {code, message, details?}}` with status
400 / 401 / 403 / 404 / 405 / 409 / 500 / 503. Main-page endpoints accept only the roles wearer and keyholder.

| Endpoint | Body | Response |
|---|---|---|
| `/api/session` | `{mainToken}` | `SessionView` |
| `/api/checkin` | `{mainToken, fix: {lat, lng, accuracy, timestamp}, purpose?: "general" \| "hunt"}` (wearer) | `{record, view}`; 403 `manual_disabled` with `checkins: auto` |
| `/api/privacy` | `{mainToken, coordinates: "zone_only"}` | `SessionView` |
| `/api/config/get` | `{configToken}` | `{config, role, sessionId, defaults}` |
| `/api/config/save` | `{configToken, config}` | `{ok: true}`; 400 with issues or `disclaimer_required` |
| `/api/capabilities` | `{configToken}` or `{mainToken}` | `{commands: [{id, extension, description, inputSchema}]}` |
| `/api/tracking/pair` | `{mainToken}` (wearer) | `{link, url, username, password, view}` |
| `/api/tracking/unpair` | `{mainToken}` | `SessionView` |
| `/api/notify/setup` | `{mainToken}` | `{topic, url, deepLink, view}`; sends a test message; 503 without `NTFY_TOKEN` |
| `/api/notify/test` | `{mainToken}` | `{ok: true}`; 409 not subscribed, 503 without token |
| `/api/notify/stop` | `{mainToken}` | `SessionView` |
| `/api/notice/ack` | `{mainToken}` (wearer) | `SessionView` (clears `rulesChanged`) |
| `/api/hunt` | `{mainToken, action: "start" \| "pause" \| "resume" \| "abort"}` | `SessionView`; 403 `hunt_action_not_allowed` |
| `/api/toy/connect` | `{mainToken, webhookId, toys, disclaimerVersion}` (wearer) | `SessionView`; 400 `toy_disclaimer` / `invalid_webhook` / `invalid_toys`, 409 `toys_disabled` |
| `/api/toy/test` | `{mainToken}` (wearer) | `SessionView`; 502 `toy_send_failed` |
| `/api/toy/confirm` | `{mainToken}` (wearer) | `SessionView` |
| `/api/toy/emergency-stop` | `{mainToken}` (wearer) | `SessionView` (stop all, ID deleted, `onEmergencyStop` applied) |
| `/api/surprise` | `{mainToken, action: {type: "release", zoneId}}` (keyholder) | `SessionView`; 403 `surprise_action_not_allowed` |
| `/api/mission` | `{mainToken, action: {type: "send", zoneId, minutes?} \| {type: "decline"} \| {type: "cancel"}}` | `SessionView`; 403 `mission_action_not_allowed` |
| `/track/owntracks` | OwnTracks message, Basic auth with device credentials | `[]`, `setWaypoints` and/or `setConfiguration` commands; 401 on wrong credentials |
| `/webhook` | Chaster webhook, Basic auth | `204` |
| `/health` | `GET` | `{ok: true, version, commit}` |

## D1 tables (`apps/worker/migrations/0001_init.sql`)

| Table | Columns | Purpose |
|---|---|---|
| `history` | `session_id, id, at, record` (PK session_id + id) | last 200 records per session |
| `devices` | `username` (PK), `session_id` (unique), `hash`, `created_at` | OwnTracks credentials (SHA-256 of the password) |
| `topics` | `session_id, role, topic, created_at` (PK session_id + role) | ntfy topics, role `wearer` / `keyholder` |
| `due` | `session_id` (PK), `next_at` (indexed) | next time a session needs a tick (1-minute cron) |
| `sent` | `session_id, key, at` (PK session_id + key) | notification dedupe and rate limit, pruned after 7 days |
| `kv` | `key` (PK), `value` | small settings (`cron:cursor`) |
