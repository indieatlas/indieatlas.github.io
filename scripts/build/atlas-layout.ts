import { UMAP } from 'umap-js';
import type { TagGroup } from '../../schema/common.ts';
import type { AtlasData, SiteGame, SiteTag } from '../../schema/site-data.ts';
import { TAG_GROUP_WEIGHTS } from '../../schema/taxonomy.ts';
import { by } from '../lib/sort.ts';

const PALETTE_SIZE = 8;
const UMAP_MIN_GAMES = 10;

/** 決定的な乱数（mulberry32） */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function cosineDistance(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 1;
  return 1 - dot / Math.sqrt(na * nb);
}

/** 作品ごとのタグの特徴ベクトル。重みは IDF に系統の係数を掛けたもの（02 §2.7.4） */
export function tagVectors(games: SiteGame[]): number[][] {
  const vocab = [...new Set(games.flatMap((g) => g.tags.map((t) => t.id)))].sort();
  const index = new Map(vocab.map((id, i) => [id, i]));
  const groups = new Map<string, TagGroup>();
  const df = new Map<string, number>();
  for (const g of games) {
    for (const t of g.tags) {
      groups.set(t.id, t.group);
      df.set(t.id, (df.get(t.id) ?? 0) + 1);
    }
  }
  const n = games.length;
  return games.map((g) => {
    const v = new Array<number>(vocab.length).fill(0);
    for (const t of g.tags) {
      const idf = Math.log(1 + n / (df.get(t.id) ?? 1));
      v[index.get(t.id)!] = idf * TAG_GROUP_WEIGHTS[groups.get(t.id)!];
    }
    return v;
  });
}

function normalize(points: [number, number][]): [number, number][] {
  if (points.length === 0) return [];
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const scale = (v: number, min: number, max: number) => (max - min < 1e-9 ? 0 : ((v - min) / (max - min)) * 2 - 1);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  return points.map(([x, y]) => [round3(scale(x, minX, maxX)), round3(scale(y, minY, maxY))]);
}

const round3 = (v: number) => Math.round(v * 1000) / 1000 || 0;

/** 作品が少ないときは、主ジャンルごとに円周上へ並べる */
function circleLayout(games: SiteGame[]): [number, number][] {
  const order = games
    .map((g, i) => ({ i, key: g.primaryGenre ?? '~' }))
    .sort(
      by(
        (x) => x.key,
        (x) => games[x.i]!.id,
      ),
    );
  const out: [number, number][] = new Array(games.length);
  order.forEach((x, k) => {
    const angle = (2 * Math.PI * k) / Math.max(1, games.length);
    out[x.i] = [Math.cos(angle) * 0.8, Math.sin(angle) * 0.8];
  });
  return out;
}

export function atlasLayout(games: SiteGame[], seed: number): [number, number][] {
  if (games.length < UMAP_MIN_GAMES) return circleLayout(games).map(([x, y]) => [round3(x), round3(y)]);
  const umap = new UMAP({
    nComponents: 2,
    nNeighbors: Math.min(15, games.length - 1),
    minDist: 0.3,
    random: seededRandom(seed),
    distanceFn: cosineDistance,
  });
  const embedding = umap.fit(tagVectors(games)) as [number, number][];
  return normalize(embedding);
}

/** アトラスのデータ（02 §2.7.4） */
export function buildAtlas(games: SiteGame[], tags: SiteTag[], seed: number): AtlasData {
  const sorted = [...games].sort(by((g) => g.id));
  const genreCount = new Map<string, number>();
  for (const g of sorted) if (g.primaryGenre) genreCount.set(g.primaryGenre, (genreCount.get(g.primaryGenre) ?? 0) + 1);
  const palette = [...genreCount.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, PALETTE_SIZE)
    .map(([id]) => id);
  const label = new Map(tags.map((t) => [t.id, t.label]));
  const coords = atlasLayout(sorted, seed);
  return {
    v: 1,
    palette: palette.map((id) => `genre:${id}`),
    legend: palette.map((id) => ({ id, label: label.get(id) ?? id })),
    points: sorted.map((g, i) => ({
      id: g.id,
      x: coords[i]![0],
      y: coords[i]![1],
      c: g.primaryGenre ? palette.indexOf(g.primaryGenre) : -1,
      s: g.coverage.filledFields >= 6 ? 3 : g.coverage.filledFields >= 4 ? 2 : 1,
      t: g.title.display,
      ...(g.image ? { i: g.image.url } : {}),
      tags: g.tags.slice(0, 3).map((t) => t.label),
      r: g.release?.overall.label ?? '発売時期不明',
    })),
  };
}
