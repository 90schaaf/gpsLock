# 01 – Analysis: Intent, Constraints, Findings

> **Historical document.** This is the original analysis and Q&A log from 2026-11-23. Several decisions were refined later
> (e.g. D1 instead of KV, a 1-minute cron, 20 m minimum radius, background tracking via OwnTracks). The current behaviour
> is specified in [02-architecture.md](02-architecture.md), [03-features.md](03-features.md) and
> [04-data-model-and-api.md](04-data-model-and-api.md); changes are listed in [CHANGELOG.md](CHANGELOG.md).

Status: **accepted** (refined with the product owner on 2026-11-23)

## 1. Intent

*Lockation* is a Chaster partner extension that makes a chastity lock react to the
wearer's physical location. The keyholder (or the wearer, for self-locks) defines
zones on a map and attaches rules and consequences to them. The wearer proves their
location by checking in from their phone (iPhone or Android) through the extension
page that Chaster embeds.

## 2. Refined decisions (Q&A log)

| # | Question | Decision |
|---|----------|----------|
| Q1 | GitHub Pages cannot hold the secret Chaster developer token. Which backend? | **Cloudflare Workers** (free tier, KV storage, cron triggers) |
| Q2 | Which GPS rules for the beta? | **All of**: required zone check-in, forbidden zones, reward zones, distance/travel goals, **scavenger hunt** (chain of checkpoints; finishing removes time, a wrong check-in adds time) |
| Q3 | Which consequences? | Add/remove time, freeze/unfreeze, pillory, log only, **plus interaction with other extensions** (tasks, verification picture, find-the-key, jigsaw, reward store, typing lines, …) |
| Q4 | Privacy of coordinates? | **Configurable per lock** (zone-only by default; exact coordinates only when configured, the wearer can always downgrade) |
| Q5 | Zone definition UI? | **Circle on an OpenStreetMap (Leaflet) map** with address search, radius ≥ 50 m |
| Q6 | Missed required check-in? | **Server cron** (every 5 min) applies the penalty even if the page is never opened |
| Q7 | Anti-cheat? | **Accuracy threshold** (+ stale-fix rejection), **speed plausibility**, optional **verification picture** |
| Q8 | Language? | **English** only |

## 3. Technical findings (Chaster Extensions API)

Sources: https://docs.chaster.app/api/extensions-api/getting-started/, the OpenAPI
document at `https://api.chaster.app/api-json`, and the public extension manifests.

1. **Embedding.** Chaster loads the *main page* in a full-screen iframe and appends
   `#<uri-encoded JSON>` with a `mainToken` (valid for 12 h). The optional
   *configuration page* receives `#{"partnerConfigurationToken": "…"}`.
2. **Everything needs a backend.** All `/api/extensions/*` endpoints require the
   secret developer token (`Authorization: Bearer …`). A pure GitHub Pages app is
   therefore impossible → static frontend on GitHub Pages + Cloudflare Worker proxy.
3. **Session auth.** `GET /api/extensions/auth/sessions/{mainToken}` →
   `{ role: wearer|keyholder, session, lockForUser, userId }`. The frontend must
   never send a `sessionId`; the backend always resolves it from the token.
4. **Config page protocol.** `postMessage` JSON strings:
   page→Chaster `{type:"partner_configuration", event:"capabilities", payload:{features:{save:true}}}`,
   Chaster→page `{type:"chaster", event:"partner_configuration_save"}`, then the page answers
   `save_loading` / `save_success` / `save_failed`. Saving: `PUT /api/extensions/configurations/{token}`.
5. **Browser capabilities.** The extension settings accept
   `browserCapabilities: ["geolocation"]`, so Chaster grants the iframe geolocation
   permission. Fallback: open the check-in page as a top-level tab.
6. **Lock actions** (`POST /api/extensions/sessions/{id}/action`): `add_time`,
   `remove_time`, `freeze`, `unfreeze`, `toggle_freeze`, `pillory {duration 300–86400 s, reason}`,
   `set_display_remaining_time`.
7. **Other endpoints:** custom log entries, session `data` (key/value),
   `metadata` (`reasonsPreventingUnlocking`, `homeActions`), `tasks/assign`,
   `verification-picture/request`, session search, regular actions.
8. **Cross-extension commands (experimental).**
   `POST /api/extensions/sessions/{id}/actions/{commandId}` with
   `{actor, input, idempotencyKey}`. `GET …/capabilities` lists the commands a lock offers.
   Public manifests on 2026-11-23:
   - `tasks`: `tasks.assign`, `tasks.start-timer`, `tasks.complete`
   - `penalty`: `penalty.increment`, `penalty.create-time-limit`, `penalty.cancel-time-limit`
   - `verification-picture`: `verification-picture.request`
   - `temporary-opening`: `temporary-opening.open`
   - `typing-lines`, `dice`, `wheel-of-fortune`, `guess-timer`, `pillory`: manifest, **no commands yet**
   - `jigsaw`, `reward-store`, `find-the-key`: **no manifest yet**

   → We implement a **generic "extension command" consequence** that discovers the
   available commands at runtime. Commands that Chaster or other partners publish
   later (for example reward store points, more typing lines, extra keys) work
   without code changes. Dedicated, friendly presets ship for the commands that exist today.
9. **Webhooks** use HTTP Basic auth (`webhookUsername`/`webhookPassword`) and send
   `extension_session.created|updated|deleted`, `action.invoke`, `lock_event.created`, …

## 4. Platform constraints and their consequences

| Constraint | Consequence for design |
|---|---|
| Browsers (especially iOS Safari) cannot track location in the background | Rules are evaluated at **check-ins**; deadlines are enforced by the **server cron** |
| Browser GPS can be spoofed (dev tools, mock-location apps) | Anti-cheat heuristics + optional verification pictures; the docs say clearly that this is a **trust-assisted** game, not a forensic proof |
| GPS accuracy is 5–50 m outdoors and worse indoors | Minimum zone radius 50 m; a check-in counts as *inside* only if `distance + accuracy ≤ radius` (strict) or `distance ≤ radius` (lenient), configurable |
| Cloudflare free tier: 50 subrequests per invocation, 100k requests/day | The cron processes sessions in batches with a cursor; fine for a beta |
| Chaster extension communication is experimental | Isolated in an adapter; failures are logged, never block the check-in |

## 5. Own ideas (accepted into the backlog)

- **Hot/cold hints** in the scavenger hunt: show the distance band to the next checkpoint.
- **Block unlocking** (`reasonsPreventingUnlocking`) until the hunt is complete or the
  required zone was visited in the current period.
- **Home actions** on the Chaster lock page ("Check-in due in 2 h") with a badge.
- **Active hours / quiet hours** for required check-ins (for example, no check-in needed 23:00–07:00).
- **Grace period** before a missed check-in is penalised.
- **Demo mode** (`?demo`): the full UI runs against an in-browser mock backend, for
  trying it out on GitHub Pages and for screenshots, without a Chaster account.
- **Privacy purge**: all stored location history is deleted when the session ends.
- **Timed freeze**: "freeze for 30 min" is unfrozen automatically by the cron.

## 6. Out of scope for the beta

Native apps, background tracking, polygons, multiple languages, Chaster "schedule"/"turn" modes.
