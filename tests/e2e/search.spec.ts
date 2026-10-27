import fs from 'node:fs';
import { expect, test } from '@playwright/test';

// 検索品質の確認（10 §10.4）。tests/fixtures/repo から作ったサイトで実行する
interface QueryCase {
  id: string;
  query: string;
  filters?: Record<string, string[]>;
  expect: { includes?: string[]; within?: number; allMatch?: Record<string, string> };
}
const cases = JSON.parse(fs.readFileSync('tests/search/queries.json', 'utf8')) as QueryCase[];
const fixture = JSON.parse(fs.readFileSync('.generated/site-data/games.json', 'utf8')) as {
  id: string;
  tags: { id: string }[];
  platforms: string[];
  japaneseSupport: { interface: string } | null;
}[];

function params(c: QueryCase): string {
  const p = new URLSearchParams();
  if (c.query) p.set('q', c.query);
  for (const [k, vs] of Object.entries(c.filters ?? {})) for (const v of vs) p.append(k, v);
  return p.toString();
}

for (const c of cases) {
  test(`${c.id}: ${c.query || '(入力なし)'} ${JSON.stringify(c.filters ?? {})}`, async ({ page }) => {
    await page.goto(`games/?${params(c)}`);
    const results = page.locator('[data-search-results] a.game-card');
    await expect(page.locator('[data-status]')).toContainText(/見つかりました|見つかりませんでした/);
    const ids = await results.evaluateAll((as) => as.map((a) => (a as HTMLElement).dataset.gameId!));
    if (c.expect.includes) {
      for (const id of c.expect.includes) {
        const at = ids.indexOf(id);
        expect(at, `${id} in ${ids.join(',')}`).toBeGreaterThanOrEqual(0);
        if (c.expect.within) expect(at).toBeLessThan(c.expect.within);
      }
    }
    if (c.expect.allMatch) {
      expect(ids.length).toBeGreaterThan(0);
      for (const id of ids) {
        const g = fixture.find((x) => x.id === id)!;
        const m = c.expect.allMatch;
        if (m.tag) expect(g.tags.map((t) => t.id)).toContain(m.tag);
        if (m.platform) expect(g.platforms).toContain(m.platform);
        if (m.ja) expect(g.japaneseSupport?.interface).toBe(m.ja);
      }
    }
  });
}

test('検索の状態が URL と同期し、結果のリンクがベースパスを含む', async ({ page, baseURL }) => {
  await page.goto('games/');
  await page.locator('#search-input').fill('lantern');
  await expect(page).toHaveURL(/\?q=lantern/);
  const href = await page.locator('[data-search-results] a.game-card').first().getAttribute('href');
  expect(href).toBe(`${new URL(baseURL!).pathname}games/g_000001/`);
});

test('0件のときは条件を外すボタンを出す', async ({ page }) => {
  await page.goto('games/?q=zzzzzz&tag=puzzle');
  await expect(page.locator('.search-empty')).toBeVisible();
  await page.getByRole('button', { name: /パズル を外す/ }).click();
  await expect(page).not.toHaveURL(/tag=puzzle/);
});
