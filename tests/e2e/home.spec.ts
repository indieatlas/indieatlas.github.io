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

test('横の記事の枠は切り替えられ、自動の切り替えは止められる', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('./');
  const rotator = page.locator('[data-rotator]');
  const dots = rotator.locator('[data-dot]');
  if ((await dots.count()) < 2) test.skip(true, '切り替える記事が足りない');
  await dots.nth(1).click();
  await expect(rotator.locator('[data-page]').nth(1)).not.toHaveAttribute('aria-hidden', 'true');
  await expect(rotator.locator('[data-page]').nth(0)).toHaveAttribute('aria-hidden', 'true');
  const pause = rotator.locator('[data-pause]');
  await pause.click();
  await expect(pause).toHaveAttribute('aria-pressed', 'true');
});

test('reduced motion の環境では自動で切り替えない', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./');
  const pause = page.locator('[data-rotator] [data-pause]');
  if ((await pause.count()) === 0) test.skip(true, '切り替える記事が足りない');
  await expect(pause).toHaveAttribute('aria-pressed', 'true');
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
