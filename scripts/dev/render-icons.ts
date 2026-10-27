import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { PROJECT_ROOT } from '../lib/repo-io.ts';

// public/favicon.svg から、PNG のアイコンを作る
//   npx tsx scripts/dev/render-icons.ts
const pub = path.join(PROJECT_ROOT, 'public');
const svg = fs.readFileSync(path.join(pub, 'favicon.svg'));
for (const [name, size] of [
  ['apple-touch-icon.png', 180],
  ['icon-192.png', 192],
  ['icon-512.png', 512],
] as const) {
  await sharp(svg, { density: 600 }).resize(size, size).png().toFile(path.join(pub, name));
  console.log(`${name} (${size}px)`);
}
