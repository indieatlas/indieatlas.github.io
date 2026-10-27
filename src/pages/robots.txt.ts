import type { APIRoute } from 'astro';
import { absoluteUrl } from '../lib/urls.ts';

// robots.txt（08 §8.3）
export const GET: APIRoute = () =>
  new Response(`User-agent: *\nAllow: /\n\nSitemap: ${absoluteUrl('sitemap-index.xml')}\n`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
