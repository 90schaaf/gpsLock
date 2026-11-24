# Setup & wiring

This guide takes you from a fresh fork to a working beta extension in Chaster.
The values below are for this repository (`90schaaf/lockation`). In a fork, replace `90schaaf` with your GitHub user and `lockation` with your repository name.
Placeholder left for you: `<worker>` = your worker URL (e.g. `https://lockation.<cf-subdomain>.workers.dev`).

## 0. Prerequisites

- Node.js ≥ 20, npm, git
- A GitHub account (Pages enabled on public repos, or on private repos with a paid plan)
- A free Cloudflare account
- A Chaster account with access to the **Extensions API** (apply at [chaster.app/developers](https://chaster.app/developers))

## 1. Get the code

```bash
git clone https://github.com/90schaaf/lockation.git
cd lockation
npm install
npm test          # all unit tests should pass
```

## 2. Create the extension in the Chaster developer portal

1. Open the developer portal → **Applications** → create an application.
2. **Tokens** (left sidebar) → create a **developer token**. Keep it secret – you need it in step 3.
3. **Extensions** → create an extension, e.g. display name *Lockation*, slug `lockation`.
   The slug cannot be changed later; it must match `EXTENSION_SLUG` in `apps/worker/wrangler.toml`.

The remaining extension settings (URLs) are filled in step 5, once the worker and pages exist.

## 3. Deploy the Cloudflare Worker

```bash
cd apps/worker
npx wrangler login
npx wrangler d1 create lockation
```

Copy the printed `database_id` into `apps/worker/wrangler.toml` (`[[d1_databases]]`) and create the tables:

```bash
npx wrangler d1 migrations apply lockation --remote
```

Then set:

```toml
[vars]
ALLOWED_ORIGINS = "https://90schaaf.github.io"
EXTENSION_SLUG  = "lockation"
```

Set the secrets (you will be prompted for the values):

```bash
npx wrangler secret put CHASTER_TOKEN      # developer token from step 2
npx wrangler secret put WEBHOOK_USERNAME   # choose any, e.g. chaster
npx wrangler secret put WEBHOOK_PASSWORD   # choose a long random string
npx wrangler secret put NTFY_TOKEN         # optional: ntfy.sh access token, enables notifications
npm run deploy                             # D1 migrations + deploy with the current commit
```

Check: `curl <worker>/health` → `{"ok":true,"version":"0.1.0","commit":"<sha>","deployedAt":"…"}` – the commit tells you
exactly which code is running (`local`/`-dirty` for a local deploy with uncommitted changes).

The OwnTracks endpoint for background tracking is `<worker>/track/owntracks`. It is derived from the request URL;
if you use a custom domain, set `PUBLIC_URL` in `[vars]`. No extra setup is needed – wearers pair their phone from the check-in page.

The cron trigger (`* * * * *`) is created automatically from `wrangler.toml`: every minute it handles only locks that are due
(forbidden-zone warnings and penalties, deadlines), every 5th minute it sweeps all locks.

**Notifications (ntfy)** – create a free account at [ntfy.sh](https://ntfy.sh), generate an **access token** (Account → Access
tokens) and store it with `npx wrangler secret put NTFY_TOKEN`. Without the token notifications are disabled and the setup
buttons are hidden. To use your own ntfy server set `NTFY_BASE` in `[vars]`. `APP_URL` (in `[vars]`) is the click target of
notifications.

**Upgrading from KV (earlier versions):** the worker now uses D1 instead of KV. Create the D1 database as above; the old KV
namespace can be deleted (`npx wrangler kv namespace delete --namespace-id <id>`), its data is not migrated.

## 4. Publish the app and docs on GitHub Pages

1. Push the repository to GitHub.
2. **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. **Settings → Secrets and variables → Actions → Variables** → add:
   - `VITE_API_BASE` = `<worker>` (no trailing slash)
4. Push to `main` (or run the *Pages* workflow manually). The workflow builds the docs to
   `https://90schaaf.github.io/lockation/` and the app to `https://90schaaf.github.io/lockation/app/`.

Check: `https://90schaaf.github.io/lockation/app/?demo` shows the demo.

### Deploy the worker automatically (recommended)

The *Worker* workflow applies the D1 migrations and deploys on every push to `main` that touches the worker or core –
once these two repository secrets exist (Settings → Secrets and variables → Actions):

1. **`CLOUDFLARE_API_TOKEN`** – Cloudflare dashboard → My Profile → **API Tokens** → *Create Token* → template
   **Edit Cloudflare Workers** → add the permission **Account → D1 → Edit** → create, copy the token.
2. **`CLOUDFLARE_ACCOUNT_ID`** – shown in the Cloudflare dashboard (Workers & Pages → right sidebar) and in the output of
   `wrangler deploy`.

With the GitHub CLI: `gh secret set CLOUDFLARE_API_TOKEN` and `gh secret set CLOUDFLARE_ACCOUNT_ID` (each prompts for the value).
Without the token the workflow still runs the tests but shows a warning "worker was NOT deployed". The deployed commit is
visible at `/health`. Secrets set with `wrangler secret put` persist across deploys.

## 5. Wire the extension in Chaster

In the developer portal, open your extension and set:

| Setting | Value |
|---------|-------|
| Main page URL | `https://90schaaf.github.io/lockation/app/index.html` |
| Configuration page URL | `https://90schaaf.github.io/lockation/app/config.html` |
| Webhook URL | `<worker>/webhook` |
| Webhook username / password | the values from step 3 |
| Browser capabilities | **geolocation** (lets the embedded page ask for the location) |
| Available modes | **Unlimited** (Lockation rate-limits check-ins itself) |
| Default configuration | `{}` |
| Configuration description | see below |
| Documentation URL | `https://90schaaf.github.io/lockation/guide/` |
| Privacy policy URL | `https://90schaaf.github.io/lockation/guide/privacy.html` |
| Disclaimer (in the description) | `https://90schaaf.github.io/lockation/guide/disclaimer.html` |

**Configuration description** (Handlebars, shown on the lock so the wearer knows the rules before accepting):

```handlebars
{{#if rules.required.enabled}}Required zones / check-ins (default every {{rules.required.intervalMinutes}} min). {{/if}}{{#if rules.forbidden.enabled}}Forbidden zones (penalty after {{rules.forbidden.firstPenaltyAfterMinutes}} min inside, then every {{rules.forbidden.repeatEveryMinutes}} min). {{/if}}{{#if rules.reward.enabled}}Reward zones. {{/if}}{{#if rules.travel.enabled}}Travel goals ({{rules.travel.stepKm}} km). {{/if}}{{#if rules.hunt.enabled}}Scavenger hunt ({{rules.hunt.checkpoints.length}} checkpoints). {{/if}}{{#if tracking.enabled}}Background tracking with OwnTracks required (check-ins: {{tracking.checkins}}). {{/if}}Location sharing: {{privacy.coordinates}}. Beta – use at your own risk, safety first.
```

**Extension description** (shown in Chaster's extension list) – include the disclaimer, e.g.:
*"Beta. Change your lock based on your GPS location. Use at your own risk – never follow a rule into danger. Not affiliated with Chaster.
Disclaimer: `https://90schaaf.github.io/lockation/guide/disclaimer.html`"*

**Webhook events**: subscribe at least to `extension_session.created`, `extension_session.updated`
and `extension_session.deleted`.

## 6. Test with testers

While the extension is in **Test** status only listed testers can use it:
developer portal → extension → **Testers** → add Chaster usernames.
For shared locks **both the wearer and the keyholder** must be testers.

Create a test lock (Chaster supports test locks), add *Lockation*, configure a zone around your
position with a short interval and check in from your phone.

Troubleshooting:

- *"The backend URL is not configured"* → `VITE_API_BASE` variable missing; re-run the Pages workflow.
- CORS errors → `ALLOWED_ORIGINS` must be exactly `https://90schaaf.github.io` (no path, no slash).
- 401 from the worker → wrong developer token secret.
- `D1_ERROR: no such table` → run `npx wrangler d1 migrations apply lockation --remote`.
- No notifications → `NTFY_TOKEN` secret missing (the setup button is then hidden).
- Webhook deliveries failing → check the delivery log in the developer portal; credentials must match.
- Location never requested inside Chaster → geolocation browser capability not enabled; the page offers *Open in new tab* as fallback.

## 7. Request review & publish

When the beta works, request a review in the developer portal (Chaster validates every extension
before release). After approval you can publish it to all users.
