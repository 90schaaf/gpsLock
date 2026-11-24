# Lockation – a GPS based Chaster extension (beta)

Lockation changes a [Chaster](https://chaster.app) lock based on the wearer's location:
**required check-ins, forbidden zones, reward zones, travel goals, scavenger hunts, curfews and optional background tracking (OwnTracks) – optionally as live tracking only, without manual check-ins**, with
consequences such as add/remove time, freeze, pillory, tasks, verification pictures and commands
of other extensions. It works on iPhone and Android in the browser (no app needed).

- 📖 **User guide:** [90schaaf.github.io/lockation/guide](https://90schaaf.github.io/lockation/guide/) (source: [`docs/guide`](docs/guide))
- 🛠 **Technical docs:** [90schaaf.github.io/lockation/technical](https://90schaaf.github.io/lockation/technical/) (source: [`docs/technical`](docs/technical))
- 🧪 **Demo:** [90schaaf.github.io/lockation/app/?demo](https://90schaaf.github.io/lockation/app/?demo)
- 📐 **Specifications:** [`specifications/`](specifications)

## Architecture

```
Chaster (iframe) ──▶ GitHub Pages: apps/web  ──fetch──▶ Cloudflare Worker: apps/worker ──▶ api.chaster.app
                                                         ▲ webhooks (Basic auth)   cron every min, D1 storage
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

1. **Chaster developer portal** – get Extensions API access, create an application, a **developer token** and an extension (slug `lockation`).
2. **Cloudflare Worker**
   ```bash
   cd apps/worker
   npx wrangler login
   npx wrangler d1 create lockation                  # put the database_id into wrangler.toml
   npx wrangler d1 migrations apply lockation --remote
   # edit ALLOWED_ORIGINS in wrangler.toml → https://90schaaf.github.io
   npx wrangler secret put CHASTER_TOKEN
   npx wrangler secret put WEBHOOK_USERNAME
   npx wrangler secret put WEBHOOK_PASSWORD
   npx wrangler secret put NTFY_TOKEN                # optional: push notifications via ntfy
   npx wrangler deploy
   ```
3. **GitHub Pages** – Settings → Pages → Source *GitHub Actions*; add the repository variable
   `VITE_API_BASE=https://lockation.<subdomain>.workers.dev`; push to `main`.
4. **Wire the extension** in the developer portal:

   | Setting | Value |
   |---|---|
   | Main page | `https://90schaaf.github.io/lockation/app/index.html` |
   | Configuration page | `https://90schaaf.github.io/lockation/app/config.html` |
   | Webhook URL | `https://lockation.<subdomain>.workers.dev/webhook` + username/password |
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
  On iPhone, OwnTracks only accepts the setup link after **ⓘ → Settings → Remote control → ⓘ → "Allow external configuration"**
  is turned on (off by default) – otherwise use the manual setup.
- Browser GPS can be spoofed – anti-cheat checks and verification pictures reduce, but don't eliminate, cheating.
- Cross-extension commands use Chaster's experimental extension communication API. Find the key, Jigsaw,
  Reward store and Typing lines don't publish commands yet; they become selectable automatically once they do.

## Disclaimer

Lockation is **beta software, provided "as is" without warranty**, and is used entirely at the user's own risk. It is a community
extension and not affiliated with Chaster. Keyholders must accept the [user disclaimer](docs/guide/disclaimer.md) before saving a
configuration (enforced by the config page and the worker). If you deploy your own instance, you are responsible for operating it.

## License

[MIT](LICENSE) © 2026 90schaaf. Map data © OpenStreetMap contributors (ODbL), shown with attribution on every map.
