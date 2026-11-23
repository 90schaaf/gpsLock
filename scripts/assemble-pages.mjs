// Combines the VitePress docs and the web app into one GitHub Pages artifact:
//   pages-dist/        ← docs/.vitepress/dist
//   pages-dist/app/    ← apps/web/dist
import { cpSync, existsSync, rmSync, writeFileSync } from 'node:fs';

const out = 'pages-dist';
rmSync(out, { recursive: true, force: true });
if (!existsSync('docs/.vitepress/dist')) throw new Error('docs not built');
if (!existsSync('apps/web/dist')) throw new Error('web app not built');
cpSync('docs/.vitepress/dist', out, { recursive: true });
cpSync('apps/web/dist', `${out}/app`, { recursive: true });
writeFileSync(`${out}/.nojekyll`, '');
console.log('Pages artifact assembled in', out);
