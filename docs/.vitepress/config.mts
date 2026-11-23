import { defineConfig } from 'vitepress';

// DOCS_BASE is set by the Pages workflow, e.g. "/lockation/".
const base = process.env.DOCS_BASE ?? '/';

export default defineConfig({
  base,
  lang: 'en-US',
  title: 'Lockation',
  description: 'A GPS based extension for Chaster – zones, check-ins, scavenger hunts.',
  cleanUrls: false,
  ignoreDeadLinks: [/^\.?\/?app\//, /\/app\//],
  head: [['meta', { name: 'theme-color', content: '#7c5cff' }]],
  themeConfig: {
    nav: [
      { text: 'User guide', link: '/guide/' },
      { text: 'Technical setup', link: '/technical/' },
      { text: 'Try the demo', link: `${base}app/?demo`, target: '_self' },
    ],
    sidebar: {
      '/guide/': [
        {
          text: 'User guide',
          items: [
            { text: 'What is Lockation?', link: '/guide/' },
            { text: 'Checking in', link: '/guide/checking-in' },
            { text: 'Background tracking', link: '/guide/background-tracking' },
            { text: 'Notifications', link: '/guide/notifications' },
            { text: 'Configuring a lock', link: '/guide/configuration' },
            { text: 'Rules explained', link: '/guide/rules' },
            { text: 'Privacy & fairness', link: '/guide/privacy' },
            { text: 'FAQ & troubleshooting', link: '/guide/faq' },
            { text: 'Disclaimer', link: '/guide/disclaimer' },
          ],
        },
      ],
      '/technical/': [
        {
          text: 'Technical',
          items: [
            { text: 'Overview', link: '/technical/' },
            { text: 'Setup & wiring', link: '/technical/setup' },
            { text: 'Local development', link: '/technical/development' },
            { text: 'Worker API & webhooks', link: '/technical/api' },
          ],
        },
      ],
    },
    search: { provider: 'local' },
    footer: {
      message: `Beta software – use at your own risk. <a href="${base}guide/disclaimer.html">Disclaimer</a> · Lockation is a community extension and is not affiliated with Chaster.`,
      copyright: 'MIT licensed · © 2026 90schaaf',
    },
  },
});
