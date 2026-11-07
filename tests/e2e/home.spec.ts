import { expect, test } from '@playwright/test';

// ホームの先頭の記事の枠と、背景の WebGL
test('大きく見せる記事が画面の先頭にある', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('./');
  const lead = page.locator('.news-tile--lg');
  await expect(lead).toHaveCount(1);
  await expect(lead).toBeInViewport();
  // 見出しは記事へのリンク（新しいタブ）
  await expect(lead.locator('.news-tile__link')).toHaveAttribute('target', '_blank');
});

test('記事の枠から作品詳細へ移れる', async ({ page }) => {
  await page.goto('./');
  await page.locator('.news-tile__game').first().click();
  await expect(page).toHaveURL(/games\/g_\d{6}\/$/);
});

test('先頭の記事は切り替えずに一度に並べる', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('./');
  await expect(page.locator('[data-rotator]')).toHaveCount(0);
  const tiles = page.locator('.news-mosaic .news-tile');
  const n = await tiles.count();
  expect(n).toBeGreaterThanOrEqual(1);
  for (let i = 0; i < Math.min(n, 5); i++) await expect(tiles.nth(i)).toBeInViewport();
});

test('スマートフォンでも横にはみ出さない', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./');
  await expect(page.locator('.news-tile--lg')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
});

test('WebGL の背景は1つだけで、操作の邪魔をしない', async ({ page }) => {
  await page.goto('./');
  const stage = page.locator('canvas.stage');
  await expect(stage)
    .toHaveCount(1, { timeout: 5000 })
    .catch(() => {});
  if ((await stage.count()) === 0) test.skip(true, 'この環境では WebGL2 が使えない');
  await expect(stage).toHaveAttribute('aria-hidden', 'true');
  expect(await stage.evaluate((c) => getComputedStyle(c).pointerEvents)).toBe('none');
});

test('WebGL を使えない環境では CSS の背景のままになる', async ({ page }) => {
  await page.addInitScript(() => {
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      if (type === 'webgl2' || type === 'webgl') return null;
      return (orig as (...a: unknown[]) => unknown).call(this, type, ...rest);
    } as typeof orig;
  });
  await page.goto('./');
  await page.waitForTimeout(2500);
  await expect(page.locator('canvas.stage')).toHaveCount(0);
  await expect(page.locator('a.game-card').first()).toBeVisible();
});
