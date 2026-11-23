# 04 – Data Model and Worker API

The source of truth for the types is `packages/core/src/config.ts` and `state.ts` (zod schemas).
This document describes the shape.

## LockationConfig v2 (stored as Chaster extension `config`)

> Since 2026-11-23 the config is **version 2** (zone roles, per-zone settings, no curfew rule). The block below shows the v1 shape
> for reference; the v2 schema is `packages/core/src/config.ts` (zones: `roles`, `matchMode`, `required`, `forbidden`, `reward`,
> `reachabilityAck`; rules.required: `anywhere`, `combine`, `warnBeforeMinutes`, `onOutsideDuringWindow`, `windowCooldownMinutes`;
> rules.forbidden: escalation timings; rules.hunt: `reveal: all`, `order`; tracking: `owntracksMode`, `quietHours`,
> `warnBeforeMinutes`; `notifications.keyholder`; antiCheat: `liveVerificationEveryHours`). v1 input is migrated by `migrateConfig`.
> State v2: `required.slots`, `forbidden.visits`, `hunt.found`, `tracking.monitoring/warnedFor`, `rulesChanged`, `nextLiveVerification`.

### v1 shape (historical)

```ts
{
  version: 1,
  timezone: "Europe/Zurich",          // IANA, captured from the configuring browser
  matchMode: "lenient" | "strict",
  zones: Zone[],                       // {id, name, lat, lng, radiusM}; zones + hunt checkpoints ≤ 20 (MAX_PLACES)
  rules: {
    required:  { enabled, zoneIds, intervalMinutes, graceMinutes, quietHours?, onSuccess, onOutside, onMissed },
    forbidden: { enabled, zoneIds, cooldownMinutes, onEnter },
    reward:    { enabled, zoneIds, cooldownMinutes, maxPerDay, onEnter },
    travel:    { enabled, stepKm, maxKmPerCheckin, dailyCapKm, onStep },
    hunt:      { enabled, checkpoints, reveal, wrongCooldownMinutes, timeLimitMinutes?,
                 blockUnlockUntilComplete, onCheckpoint, onWrong, onComplete, onTimeout },
    curfew:    { enabled, zoneIds, start, end, cooldownMinutes, onOutside }          // F15
  },
  tracking: { enabled, heartbeatMinutes, onHeartbeatMissed, entryConfirmMinutes,
              maxDelayMinutes, countsAsCheckin, liveOnly },                        // F14, F16
  antiCheat: { maxAccuracyM, maxFixAgeSeconds, maxSpeedKmh, onImplausible,
               implausibleConsequences, verificationPicture, verificationProbability, minIntervalSeconds },
  privacy: { coordinates: "zone_only" | "exact" },
  disclaimer?: { version, acceptedAt: ISO }   // F18 – required on save (version ≥ DISCLAIMER_VERSION), optional on read
}
```

## LockationState (stored in Chaster session `data.lockation`)

```ts
{
  v: 1,
  startedAt: ISO,
  lastAttemptAt?: ISO,
  lastAccepted?: { lat, lng, accuracy, at },     // rounded in zone_only mode
  privacyOverride?: "zone_only",
  required: { lastValidAt?: ISO, nextDeadline?: ISO, missedCount, missedSinceValid? },   // missedSinceValid: F16 recovery
  forbidden: { lastTriggered: Record<zoneId, ISO> },
  reward:    { lastTriggered: Record<zoneId, ISO>, day: "YYYY-MM-DD", countToday },
  travel:    { pendingKm, totalKm, day, kmToday },
  hunt:      { index, status: "active"|"completed"|"failed", lastWrongAt?, lastDistanceBand? },
  presence:  Record<zoneId, { since: ISO, lastSeen: ISO }>,                     // F14
  tracking:  { deviceUser?, pairedAt?, lastSeenAt?, nextHeartbeat?, missedCount, waypointsHash?, trackedCount },
  curfew:    { lastTriggered? },
  freezeUntil?: ISO,
  checkinCount, acceptedCount
}
```

## CheckinRecord (KV history)

```ts
{ id, at, outcome: "accepted"|"rejected", reason?, accuracy, lat?, lng?,
  zones: string[] /* names matched */, events: string[] /* human readable */,
  consequences: { type, ok, error? }[], flagged?: "implausible_speed" }
```

## Worker HTTP API

All endpoints: `POST`, JSON, CORS restricted. Errors: `{error: {code, message}}` with status 400/401/403/409/429/500.

| Endpoint | Body | Response |
|---|---|---|
| `/api/session` | `{mainToken}` | `SessionView` (role, config summary, state view, history if allowed) |
| `/api/checkin` | `{mainToken, fix}` | `{record, view: SessionView}`; 403 `manual_disabled` in live-only mode (F16) |
| `/api/privacy` | `{mainToken, coordinates: "zone_only"}` | `SessionView` |
| `/api/config/get` | `{configToken}` | `{config, role, sessionId, defaults}` |
| `/api/config/save` | `{configToken, config}` | `{ok:true}` or 400 with zod issues / `disclaimer_required` (F18) |
| `/api/capabilities` | `{configToken}` or `{mainToken}` | `{commands:[{id, extension, description, inputSchema}]}` |
| `/api/tracking/pair` | `{mainToken}` | `{link, url, username, password, view}` (F14) |
| `/api/tracking/unpair` | `{mainToken}` | `SessionView` |
| `/api/notify/setup` | `{mainToken}` | `{topic, url, deepLink, view}` (503 without ntfy token) |
| `/api/notify/stop` | `{mainToken}` | `SessionView` |
| `/api/notice/ack` | `{mainToken}` (wearer) | `SessionView` |
| `/track/owntracks` | OwnTracks message (Basic auth) | `[]`, `[setWaypoints cmd]` and/or `[setConfiguration cmd]` |
| `/webhook` | Chaster webhook | `204` |
| `/health` | GET | `{ok:true, version}` |
