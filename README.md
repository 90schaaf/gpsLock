# GPS Lock – a GPS based Chaster extension (beta)

GPS Lock changes a [Chaster](https://chaster.app) lock based on the wearer's location:
**required check-ins, forbidden zones, reward zones, travel goals, scavenger hunts, curfews and optional background tracking (OwnTracks) – optionally as live tracking only, without manual check-ins**, with
consequences such as add/remove time, freeze, pillory, tasks, verification pictures and commands
of other extensions. It works on iPhone and Android in the browser (no app needed).

- 📖 **User guide:** `https://<gh-user>.github.io/<repo>/guide/` (source: [`docs/guide`](docs/guide))
- 🛠 **Technical docs:** `https://<gh-user>.github.io/<repo>/technical/` (source: [`docs/technical`](docs/technical))
- 🧪 **Demo:** `https://<gh-user>.github.io/<repo>/app/?demo`
- 📐 **Specifications:** [`specifications/`](specifications)

## Architecture

```
Chaster (iframe) ──▶ GitHub Pages: apps/web  ──fetch──▶ Cloudflare Worker: apps/worker ──▶ api.chaster.app
                                                         ▲ webhooks (Basic auth)   cron */5 min, KV history
```

| Path | What |
|------|------|
| `packages/core` | Rule engine, config schema, geo math, view models (pure TS, unit tested) |
| `apps/worker` | Cloudflare Worker – holds the secret developer token, runs rules, webhooks, cron |
| `apps/web` | Main page + configuration page (Vite, Preact, Leaflet/OpenStreetMap), demo mode |
| `docs` | VitePress documentation site (published together with the app) |

A backend is unavoidable: every Chaster Extensions API call needs the secret developer token, which must not be
shipped to a public GitHub Pages site. Cloudflare Workers' free tier is enough for the beta.

## Quick start

```bash
npm install
npm test                 # core + worker + web tests
npm run dev:web          # http://localhost:5173/?demo  (runs fully in the browser)
```

## Setup & wiring (summary)

Full step-by-step guide: [`docs/technical/setup.md`](docs/technical/setup.md).

1. **Chaster developer portal** – get Extensions API access, create an application, a **developer token** and an extension (slug `gps-lock`).
2. **Cloudflare Worker**
   ```bash
   cd apps/worker
   npx wrangler login
   npx wrangler kv namespace create GPS_LOCK_KV     # put the id into wrangler.toml
   # edit ALLOWED_ORIGINS in wrangler.toml → https://<gh-user>.github.io
   npx wrangler secret put CHASTER_TOKEN
   npx wrangler secret put WEBHOOK_USERNAME
   npx wrangler secret put WEBHOOK_PASSWORD
   npx wrangler deploy
   ```
3. **GitHub Pages** – Settings → Pages → Source *GitHub Actions*; add the repository variable
   `VITE_API_BASE=https://gps-lock.<subdomain>.workers.dev`; push to `main`.
4. **Wire the extension** in the developer portal:

   | Setting | Value |
   |---|---|
   | Main page | `https://<gh-user>.github.io/<repo>/app/index.html` |
   | Configuration page | `https://<gh-user>.github.io/<repo>/app/config.html` |
   | Webhook URL | `https://gps-lock.<subdomain>.workers.dev/webhook` + username/password |
   | Browser capabilities | `geolocation` |
   | Modes | Unlimited |
   | Webhook events | `extension_session.created`, `.updated`, `.deleted` |

5. **Testers** – add your (and your keyholder's) Chaster username in the *Testers* tab, create a test lock, check in.

## CI/CD

| Workflow | Does |
|---|---|
| `ci.yml` | typecheck, tests, build smoke test on every push / PR |
| `pages.yml` | builds docs + app and deploys GitHub Pages |
| `worker.yml` | tests and `wrangler deploy` when the `CLOUDFLARE_API_TOKEN` secret is set |

## Limitations (beta)

- Without background tracking, location is only known at check-ins (browsers cannot track in the background). Background tracking needs the free OwnTracks app and "Always" location permission; iOS may delay updates in low-power mode.
- Browser GPS can be spoofed – anti-cheat checks and verification pictures reduce, but don't eliminate, cheating.
- Cross-extension commands use Chaster's experimental extension communication API. Find the key, Jigsaw,
  Reward store and Typing lines don't publish commands yet; they become selectable automatically once they do.

## License

[MIT](LICENSE) © 2026 90schaaf. Map data © OpenStreetMap contributors (ODbL), shown with attribution on every map.
