import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { PROJECT_ROOT } from '../lib/repo-io.ts';

/**
 * dist/ を任意のベースパスの下に配信する（08 §8.4）。
 * ベースパスの外へのリクエストは 404 にし、ベースパスの付け忘れを見つける。
 *   npx tsx scripts/dev/serve-dist.ts --base /indieatlas/ --port 4173
 */
const { values } = parseArgs({
  options: {
    base: { type: 'string', default: process.env.BASE_PATH ?? '/' },
    port: { type: 'string', default: '4173' },
    dir: { type: 'string', default: path.join(PROJECT_ROOT, 'dist') },
  },
});
const base = values.base!.endsWith('/') ? values.base! : `${values.base}/`;
const root = path.resolve(values.dir!);

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.pf_meta': 'application/octet-stream',
  '.pf_index': 'application/octet-stream',
  '.pf_fragment': 'application/octet-stream',
  '.pagefind': 'application/octet-stream',
};

function send(res: http.ServerResponse, status: number, file?: string): void {
  if (!file) {
    const notFound = path.join(root, '404.html');
    res.writeHead(404, { 'content-type': TYPES['.html']! });
    res.end(fs.existsSync(notFound) ? fs.readFileSync(notFound) : 'Not Found');
    return;
  }
  res.writeHead(status, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

http
  .createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    if (!pathname.startsWith(base)) return send(res, 404);
    let file = path.join(root, pathname.slice(base.length));
    if (!file.startsWith(root)) return send(res, 404);
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
      if (!pathname.endsWith('/')) {
        res.writeHead(301, { location: `${pathname}/` });
        res.end();
        return;
      }
      file = path.join(file, 'index.html');
    }
    if (!fs.existsSync(file)) return send(res, 404);
    send(res, 200, file);
  })
  .listen(Number(values.port), () => {
    console.log(`serving ${root} at http://localhost:${values.port}${base}`);
  });
