// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

const site = process.env.SITE_URL ?? 'http://localhost:4321';
const base = process.env.BASE_PATH ?? '/';
if (!/^\/([^/]+\/)*$/.test(base)) throw new Error(`BASE_PATH must start and end with "/": ${base}`);
if (!/^https?:\/\/[^/]+$/.test(site)) throw new Error(`SITE_URL must be an origin without a path: ${site}`);

export default defineConfig({
  site,
  base,
  output: 'static',
  trailingSlash: 'always',
  build: { format: 'directory', assets: '_assets' },
  integrations: [
    sitemap({ filter: (page) => !page.includes('/dev/') }),
    {
      // 部品の確認用のページは、手元の開発サーバーでだけ生成する（09 P1-06）
      name: 'indieatlas-dev-pages',
      hooks: {
        'astro:config:setup': ({ command, injectRoute }) => {
          if (command === 'dev') injectRoute({ pattern: '/dev/components', entrypoint: './src/dev/components.astro' });
        },
      },
    },
  ],
});
