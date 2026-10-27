import { expect, test } from '@playwright/test';

// /repository-name/ の配下とドメインの直下の両方で、リンクと検索が動作する（受入基準9）
test('ページ内のリンクと canonical がベースパスを含む', async ({ page, baseURL }) => {
  const base = new URL(baseURL!).pathname;
  for (const p of ['./', 'games/', 'games/g_000001/', 'articles/', 'collections/col_0001/', 'about/']) {
    await page.goto(p);
    const hrefs = await page
      .locator('a[href^="/"], link[href^="/"], img[src^="/"], script[src^="/"]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('href') ?? e.getAttribute('src')!));
    for (const h of hrefs) expect(h.startsWith(base), `${p}: ${h}`).toBe(true);
    const canonical = await page.locator('link[rel=canonical]').getAttribute('href');
    expect(new URL(canonical!).pathname.startsWith(base)).toBe(true);
  }
});

test('検索の結果がベースパスを含み、作品詳細へ移れる', async ({ page, baseURL }) => {
  await page.goto('games/?q=lantern');
  const first = page.locator('[data-search-results] a.game-card').first();
  await expect(first).toBeVisible();
  await first.click();
  await expect(page).toHaveURL(`${baseURL}games/g_000001/`);
});
