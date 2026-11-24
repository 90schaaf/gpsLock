# Local development

```bash
npm install
npm test            # core + worker + web unit tests
npm run typecheck
```

## Demo mode (no Chaster, no worker)

```bash
npm run dev:web
# open http://localhost:5173/?demo and http://localhost:5173/config.html?demo
```

The demo runs `packages/core` in the browser and keeps everything in `localStorage`. On the main page,
tap the map to simulate a position, switch between wearer and keyholder, and look at the simulated
Chaster history. Use "Reset around me" to centre the demo zones on your real location.

**Fake GPS by mouse:** with background tracking enabled in the demo config, every click on the map sends a fake background
location there (like OwnTracks, including the manual-send setup confirmation; the speed check is skipped for clicks). The
demo bar button *🖱 Map click* switches between "send location" and "only set position" (then the click only sets the
position for the next check-in or *Demo: send as background update*).

## Against the real Chaster API

1. `cp apps/worker/.dev.vars.example apps/worker/.dev.vars` and fill in your developer token and webhook credentials.
2. `npm run dev:worker` → `http://localhost:8787`
3. `apps/web/.env.local`: `VITE_API_BASE=http://localhost:8787`, then `npm run dev:web`.
4. In the Chaster developer portal temporarily point the main/config page URLs to your dev server
   (a private network URL works for development, see Chaster docs). Phones need HTTPS for geolocation –
   use a tunnel such as `cloudflared tunnel --url http://localhost:5173`.

## Project layout

```
packages/core   rule engine, config schema, geo, view models   (vitest)
apps/worker     Cloudflare Worker                              (vitest, fake Chaster API)
apps/web        main + config page                             (vitest + jsdom)
docs            this site (VitePress)
specifications  spec-driven development documents
```

## Tests and specifications

Every feature in `specifications/03-features.md` has acceptance criteria (F1–F13). The test names
reference them, e.g. `F6 scavenger hunt › AC2 wrong hunt check-in adds time`.

## Building the Pages artifact locally

```bash
PAGES_BASE=/lockation/app/ DOCS_BASE=/lockation/ VITE_API_BASE=https://… npm run build
# → pages-dist/
```
