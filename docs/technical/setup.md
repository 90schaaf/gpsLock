# Setup & wiring

This guide takes you from a fresh fork to a working beta extension in Chaster.
Placeholders: `<gh-user>` = your GitHub user, `<repo>` = repository name (e.g. `gpsLock`),
`<worker>` = your worker URL (e.g. `https://gps-lock.<cf-subdomain>.workers.dev`).

## 0. Prerequisites

- Node.js ≥ 20, npm, git
- A GitHub account (Pages enabled on public repos, or on private repos with a paid plan)
- A free Cloudflare account
- A Chaster account with access to the **Extensions API** (apply at [chaster.app/developers](https://chaster.app/developers))

## 1. Get the code

```bash
git clone https://github.com/<gh-user>/<repo>.git
cd <repo>
npm install
npm test          # all unit tests should pass
```

## 2. Create the extension in the Chaster developer portal

1. Open the developer portal → **Applications** → create an application.
2. **Tokens** (left sidebar) → create a **developer token**. Keep it secret – you need it in step 3.
3. **Extensions** → create an extension, e.g. display name *GPS Lock*, slug `gps-lock`.
   The slug cannot be changed later; it must match `EXTENSION_SLUG` in `apps/worker/wrangler.toml`.

The remaining extension settings (URLs) are filled in step 5, once the worker and pages exist.

## 3. Deploy the Cloudflare Worker

```bash
cd apps/worker
npx wrangler login
npx wrangler kv namespace create GPS_LOCK_KV
```

Copy the printed `id` into `apps/worker/wrangler.toml` (`[[kv_namespaces]]`), and set:

```toml
[vars]
ALLOWED_ORIGINS = "https://<gh-user>.github.io"
EXTENSION_SLUG  = "gps-lock"
```

Set the secrets (you will be prompted for the values):

```bash
npx wrangler secret put CHASTER_TOKEN      # developer token from step 2
npx wrangler secret put WEBHOOK_USERNAME   # choose any, e.g. chaster
npx wrangler secret put WEBHOOK_PASSWORD   # choose a long random string
npx wrangler deploy
```

Check: `curl <worker>/health` → `{"ok":true,...}`.

The OwnTracks endpoint for background tracking is `<worker>/track/owntracks`. It is derived from the request URL;
if you use a custom domain, set `PUBLIC_URL` in `[vars]`. No extra setup is needed – wearers pair their phone from the check-in page.

The cron trigger (`*/5 * * * *`) is created automatically from `wrangler.toml`.

## 4. Publish the app and docs on GitHub Pages

1. Push the repository to GitHub.
2. **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. **Settings → Secrets and variables → Actions → Variables** → add:
   - `VITE_API_BASE` = `<worker>` (no trailing slash)
4. Push to `main` (or run the *Pages* workflow manually). The workflow builds the docs to
   `https://<gh-user>.github.io/<repo>/` and the app to `https://<gh-user>.github.io/<repo>/app/`.

Check: `https://<gh-user>.github.io/<repo>/app/?demo` shows the demo.

### Optional: deploy the worker from GitHub Actions

Add the repository **secret** `CLOUDFLARE_API_TOKEN` (Cloudflare → My Profile → API Tokens →
template *Edit Cloudflare Workers*) and optionally `CLOUDFLARE_ACCOUNT_ID`. The *Worker* workflow then deploys
on every push to `main` that touches the worker or core. Secrets set with `wrangler secret put` persist across deploys.

## 5. Wire the extension in Chaster

In the developer portal, open your extension and set:

| Setting | Value |
|---------|-------|
| Main page URL | `https://<gh-user>.github.io/<repo>/app/index.html` |
| Configuration page URL | `https://<gh-user>.github.io/<repo>/app/config.html` |
| Webhook URL | `<worker>/webhook` |
| Webhook username / password | the values from step 3 |
| Browser capabilities | **geolocation** (lets the embedded page ask for the location) |
| Available modes | **Unlimited** (GPS Lock rate-limits check-ins itself) |
| Default configuration | `{}` |
| Configuration description | see below |
| Documentation URL | `https://<gh-user>.github.io/<repo>/guide/` |
| Privacy policy URL | `https://<gh-user>.github.io/<repo>/guide/privacy.html` |

**Configuration description** (Handlebars, shown on the lock so the wearer knows the rules before accepting):

```handlebars
{{#if rules.required.enabled}}GPS check-in every {{rules.required.intervalMinutes}} min. {{/if}}{{#if rules.forbidden.enabled}}Forbidden zones. {{/if}}{{#if rules.reward.enabled}}Reward zones. {{/if}}{{#if rules.travel.enabled}}Travel goals ({{rules.travel.stepKm}} km). {{/if}}{{#if rules.hunt.enabled}}Scavenger hunt ({{rules.hunt.checkpoints.length}} checkpoints). {{/if}}{{#if tracking.enabled}}Background tracking with OwnTracks required{{#if tracking.liveOnly}} (live tracking only, no manual check-ins){{/if}}. {{/if}}{{#if rules.curfew.enabled}}Curfew {{rules.curfew.start}}–{{rules.curfew.end}}. {{/if}}Location sharing: {{privacy.coordinates}}.
```

**Webhook events**: subscribe at least to `extension_session.created`, `extension_session.updated`
and `extension_session.deleted`.

## 6. Test with testers

While the extension is in **Test** status only listed testers can use it:
developer portal → extension → **Testers** → add Chaster usernames.
For shared locks **both the wearer and the keyholder** must be testers.

Create a test lock (Chaster supports test locks), add *GPS Lock*, configure a zone around your
position with a short interval and check in from your phone.

Troubleshooting:

- *"The backend URL is not configured"* → `VITE_API_BASE` variable missing; re-run the Pages workflow.
- CORS errors → `ALLOWED_ORIGINS` must be exactly `https://<gh-user>.github.io` (no path, no slash).
- 401 from the worker → wrong developer token secret.
- Webhook deliveries failing → check the delivery log in the developer portal; credentials must match.
- Location never requested inside Chaster → geolocation browser capability not enabled; the page offers *Open in new tab* as fallback.

## 7. Request review & publish

When the beta works, request a review in the developer portal (Chaster validates every extension
before release). After approval you can publish it to all users.
