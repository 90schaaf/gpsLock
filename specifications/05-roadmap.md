# 05 – Roadmap

Feature IDs refer to [03-features.md](03-features.md); details of past changes are in [CHANGELOG.md](CHANGELOG.md).

## Done

| It. | Scope |
|-----|-------|
| 0 | Specs, monorepo scaffolding, CI |
| 1 | `packages/core`: geo, config schema, anti-cheat, required / forbidden / reward / travel / hunt rules, tick, consequences, privacy (F1–F9) |
| 2 | `apps/worker`: Chaster client, routes, webhook, cron, history, lock page metadata (F12) |
| 3 | `apps/web`: main page, config page, demo mode (F10, F11, F13) |
| 4 | Docs (VitePress), Pages and worker deploy workflows |
| 5 | Disclaimer and keyholder confirmation (F18) |
| 6 | Background tracking with OwnTracks (F14) |
| 7 | Live tracking only (now check-in mode `auto`, F14) |
| 8 | Mobile layout, live position, real tracking status, access control (F19) |
| 9 | Configuration v2: zone roles, per-zone settings, forbidden escalation, stay windows, reward per zone, hunt reveal `all` / order, OwnTracks mode, quiet hours, warnings, reachability check (F1–F6, F14, F17) |
| 10 | Worker v2: D1 storage, ntfy notifications for wearer and keyholder, 1-minute due cron, config change notices (F22, F23) |
| 11 | Hunt control (start / pause / end / give up), tracking setup confirmed by a manual send, test notification, one reachability confirmation, settings import / export (F6, F14, F22, F17, F24) |
| 12 | Check-in mode selector, 3-minute automatic interval, OwnTracks report interval, zone actions (F14, F2, F21) |
| 13 | UI polish: inline validation, disclaimer gate on the Zones tab, iframe-resizer, signal countdown, Import / Export tab, demo map-click fake GPS (F11, F14, F13, F19) |

## In progress (decided 2026-11-24)

- Remove v1 config compatibility (`migrateConfig` from v1, `migrateState`) and the legacy tracking fields
  (`checkins: "manual"`, `countsAsCheckin`, `liveOnly`); `tracking.checkins` becomes `"both" | "auto"`.
- Remove `rules.required.combine` (each required zone always has its own deadline).
- Scheduled hunt start (`startAt`) interpreted in the lock's timezone.
- Move the application service into `packages/core` with ports (Chaster, storage, notifications), shared by the worker and
  the demo backend.
- `/health` returns `{ok, version, commit}`.

## Planned (specified 2026-11-25)

| Item | Notes |
|---|---|
| Toy control via XToys (F27) | 1. Lockation XToys proxy script + toy test page (`toys.html`, demo panel) (browser requests, Android background and several toys confirmed) · 2. connection in a lock, consequence type `toy` incl. intensity changes, wearer limits, emergency stop · 3. "while inside" with dead-man's switch |
| Toy liveness check (F27, later) | WebSocket ping / pong with the XToys script, optional "toy required" rule – on hold |

## Open

| Item | Notes |
|---|---|
| Concurrent updates | Durable Object per session, or a version check on `data.lockation`, so a webhook, the cron and an OwnTracks message can't overwrite each other's state |
| Rate limiting | Per token / device / IP on the worker endpoints |
| Presets for forbidden timings | e.g. "strict", "relaxed", "warning only" |
| Playwright mobile tests | Main and config page at 360–618 px, inside an iframe |
| Real-device OwnTracks checklist | iPhone and Android: pairing, manual send, move / significant mode, region transitions, quiet hours, battery |
| OwnTracks `setConfiguration` on iOS | Verify that remote configuration (monitoring, locator interval) is applied with *Allow external configuration* |
| Unified "zone rules" model | One per-zone rule model instead of separate required / forbidden / reward / actions settings |
| Later | Polygons, keyholder approval queue, i18n, own companion app, Lockation manifest so other extensions can react to events |

## Before the beta

- [ ] Chaster developer portal: slug `lockation`, main and config iframe URLs, mode(s) (Unlimited), browser capability
      `geolocation`, webhook URL and credentials.
- [ ] Worker secrets: `CHASTER_TOKEN`, `WEBHOOK_USERNAME`, `WEBHOOK_PASSWORD`, `NTFY_TOKEN`.
- [ ] D1: `wrangler d1 create lockation`, `wrangler d1 migrations apply lockation --remote`.
- [ ] End-to-end test with a test lock (incl. which role names Chaster uses while a lock is being created).
- [ ] OwnTracks test on a real iPhone and Android phone (checklist above).
- [ ] Disclaimer and privacy page reviewed.
- [ ] Testers invited.
