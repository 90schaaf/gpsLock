// Local deploy: runs the D1 migrations and deploys with the current commit, so /health shows what is running.
// Usage: npm run deploy -w @lockation/worker
import { execSync } from 'node:child_process';

const sh = (cmd) => execSync(cmd, { stdio: 'inherit' });
let commit = 'local';
try {
  commit = execSync('git rev-parse --short HEAD').toString().trim();
  if (execSync('git status --porcelain').toString().trim()) commit += '-dirty';
} catch {
  /* not a git checkout */
}
sh('npx wrangler d1 migrations apply lockation --remote');
sh(`npx wrangler deploy --var GIT_SHA:${commit} --var DEPLOYED_AT:${new Date().toISOString()}`);
